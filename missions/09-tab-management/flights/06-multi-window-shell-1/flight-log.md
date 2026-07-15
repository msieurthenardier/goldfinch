# Flight Log: Multi-Window Shell, Part 1

**Flight**: [Multi-Window Shell, Part 1](flight.md)

## Summary

Converted the single-window shell into a window registry with per-window
chrome/tab state, and landed "Move to new window" as the first cross-window
operation — re-parenting the live guest view so the page keeps its state.
Five legs: the spike returned full GO (re-parent primary path, overlay
roaming, `close` hook, WSLg focus facts); leg 2 (the HIGH-risk M05-scale
conversion) built the registry + the three routing classes across a ~30-site
census and split the lifecycle so closing one of N never quits and closing
the last does; leg 3 added the global-tagged closed-tab stack with
whole-window capture at `close`, plus the push-cache sync opener; leg 4
landed the cross-window move protocol; leg 5 verified.

The flight's defining event was a HIGH-severity blocker discovered in leg 4:
closing ANY window hung the main process permanently with zero error output.
A dedicated fix-cycle (differential bisect against a HEAD control worktree)
root-caused it to `registry.remove(win.id)` reading a property on an
already-DESTROYED BaseWindow inside the `closed` handler — the throw inside
the native→JS emission aborted the listener chain (manufacturing the
"`closed` never fires" evidence that pointed the original forensics away
from it) and wedged the Wayland close path. Introduced by leg 2's lifecycle
split. Two-line fix: capture `winId` at create. It also retro-explained the
leg-2/3 "first SIGTERM survives" anomaly — same wedge on the quit path, now
gone. New standing rule in Decisions: never dereference `win.*` inside
`closed`-or-later handlers.

Overlay MULTI-instance conversion, capture semantics, and automation
multi-window semantics stay in F7; F6 ships a roaming-singleton interim.
The 46-spec singular-window audit (`docs/behavior-specs-single-window-audit.md`)
is F7 input.

**Verification**: `multi-window-shell` PASS 9/9 (fresh re-run after errata);
regression pair `tab-context-menu` 10/10 and `closed-tab-reopen` 9/9;
1715/1715 suites, lint, typecheck, a11y green. Flight-end review:
confirmed, no issues.

---

## Reconnaissance Report (Phase 1b — code interrogation, 2026-07-14)

Fact base for the design (READ-ONLY sweep; citations are branch-current at
recon time). Digest — the flight spec's DDs cite these facts.

### Per-window singleton census (main.js)

Per-window-in-nature module-scope mutables: `mainWindow` (:207),
`chromeView` + `getChromeContents()` (:212, :216), `tabViews` Map
(wcId → {view, partition, trusted, active}, :219), `activeTabWcId` (:221),
find-overlay cluster (`overlayView`, `overlayVisible`, `lastGuestBounds`,
`findOverlayTabWcId`, `findOverlayLastQueryText`, `overlayReady`,
`pendingOverlayInit`, :235-259), `menuOverlay` manager (:514-543, bound at
construction to `getContentView: () => mainWindow.contentView`).

Genuinely app-global: `closedTabStack` (:225), internal-session machinery,
MCP server/status/toggle, `historyRecorder`, downloads cluster, privacy
maps (data window-agnostic; DELIVERY via the singleton chrome),
`farbleSeeds`.

### Lifecycle facts

`window-close` IPC → `mainWindow.close()` (:2066, deliberately not quit);
`mainWindow.on('closed')` (:953-969) nulls singletons and tears down BOTH
overlay singletons (find before sheet — ordering pin) — i.e. close==app-
teardown today; `window-all-closed` (:2974) quits non-darwin;
`before-quit` (:2964) flushes downloads + stops MCP; `will-quit` (:2988)
closes history store; kebab Exit → `app.quit()` (:2071).
`app.on('activate')` (:2956) is the ONLY `getAllWindows()`-aware call.

### Channel coupling

Singleton-resolving IPCs: window controls (:2059-2067), dialog parenting
(:1440), tab-create/close/set-active attach-detach-raise on
`mainWindow.contentView` (:2137, :2211, :2353 — :2137/:2211 dereference
`mainWindow` UNGUARDED), sender-identity checks against
`getChromeContents()` (menu-overlay :558/:572, find-overlay :2435+, sheet
sender :551-554, dev seam :2887). Main→chrome send sites enumerated
(~30 — full list in the recon transcript); `broadcastToChromeAndInternal`
(:1759-1769) is the chokepoint: ONE chrome + all internal-session contents,
~12 channels (settings/shields/jars/jar-wiped/history/downloads/automation-
activity).

### Re-parenting primitive

Attach = `contentView.addChildView` (tab-create :2137, raise-by-re-add
:2353, overlays); detach = `removeChildView` ONLY on the destroy path for
guests (:2211 → destroy :2213) and on overlay hide (no destroy). **No
destroy-free guest detach exists** — the DD1 spike is genuinely novel
territory; CLAUDE.md's native-surface invariant (rule 3) demands the
on-platform spike + rendered-pixel judgment. Guests are positioned by
renderer-measured DIP bounds (`tab-set-bounds` :2399-2417; chrome DOM rect
space ≡ window content DIPs).

### Automation surface

Engine built over `createEngine(getChromeContents, ...)` (engine.js:55);
`enumerateTabs` = `executeInRenderer('...listTabs()')` (tabs.js:62-65) —
**renderer-Map-backed**: with two windows it silently sees only the bound
chrome's tabs. `openTab`/`closeTab`/`activateTab` same-chrome.
`getChromeTarget` returns the one chrome (engine.js:118-122).
`captureWindow`/`grabWindow` (main.js:653-781): desktopCapturer best-size-
match heuristic (:672-683 — can pick the WRONG of two similar windows) +
Wayland composite hard-wired to the singletons. `isTabViewWcId` gate
injected from the one `tabViews` (:799, :2877; enforced resolve.js:114).
CLAUDE.md:404 pre-registers the listTabs creation-order revisit at
multi-window.

### Renderer single-window assumptions

Per-document state (tabs Map :113, activeTabId :114, panels, caches) is
naturally per-window IF each window gets its own chrome document. No
window-id concept in the bridge (window controls carry no handle). Jar
caches + sweeps (`onJarWiped` :175-190, `refreshOpenTabJars` :221+) are
fed by the broadcast chokepoint. Boot tab: every chrome document creates
one home tab at load (:3726-3729) — move-to-new-window needs suppression.
Reopen applies `insertAt: entry.stripIndex` (:3365-3378). Keyboard
classifier per-document; BUT main-side guest forwarders
(`handleGuestChromeShortcut` :1064-1151) and the sheet accelerator
(:449-505) act on the GLOBAL chrome/active-tab singletons — window-2 guest
keystrokes would dispatch into window 1's chrome without the registry.

### Closed-tab stack

Sole capture site inside `tab-close` (:2181-2210, pre-destroy, positive
persist-jar allowlist); entry `{url, title, jarId, stripIndex, navEntries,
navIndex, closedAt}` (:2198-2206). Consumers: `tab-reopen` (:2244-2269),
`closed-tab-stack-size` (:2295), renderer dispatch (:3365-3378) + tab-
context reuse (:685-691). windowId must flow at: capture (from
event.sender's window), pop (stripIndex validity rule), size (stays
global per DD4).

### Behavior-spec single-window sweep (46 specs — DD8 audit input)

- **Probe-walk specs (would find the WRONG sheet/chrome with 2 windows —
  10)**: menu-overlay, page-context-menu, find-overlay-geometry,
  internal-tab-menus, kebab-menu, menu-dismissal, tab-context-menu,
  closed-tab-reopen, tab-cycling, omnibox-suggestions.
- **getChromeTarget-ambiguity (33)**: the list is in the recon transcript;
  includes all probe-walk specs plus the strip/settings/jar corpus.
- **captureWindow/window-bounds/focus assumptions (~18)**: incl.
  find-overlay-geometry maximize tracking, tab-surface-geometry,
  responsive-tab-strip, devtools-cdp-conflict (detached-window assert).
- **Exact-count preconditions that would OUTRIGHT FAIL**: popup-jar-
  inheritance (:47 total-count), kebab-menu (:112+), unified-tab-controls
  (:86-89), tab-keyboard-operability (:47/:51), closed-tab-reopen (:118 —
  explicitly scoped "single window this mission").
- **No coupling (10)**: downloads-surface, farbling-correctness,
  find-in-page, history-automation-isolation, history-recording,
  internal-session-exclusion, mcp-loopback-origin-guard,
  observe-refusal-contract, page-zoom, print-to-pdf.

Full per-spec detail goes into `docs/behavior-specs-single-window-audit.md`
(DD8 deliverable, leg 4).

### Size/split facts

main.js 2994 lines; renderer.js 3768. Per-menu cluster locations recorded
(renderer.js:240-283, :287-372, :376-505, :512-709, :723-745, :870-1041;
MENU_LABELS sheet-side menu-overlay.js:128) — input to the post-mission
renderer-split maintenance flight (DD2 decision).

### Surprises flagged

1. Unguarded `mainWindow` derefs in tab-create/tab-close (:2137, :2211).
2. Sheet accelerator acts on the global active tab (:470).
3. `grabWindow` desktopCapturer best-size-match can mis-pick between two
   similar windows even pre-F6 (:672-683).
4. `broadcastToChromeAndInternal` single-chrome fan-out chokepoint (:1759).
5. `enumerateTabs` silently window-1-only under N windows.
6. CLAUDE.md pre-registered multi-window hooks (:404 listTabs order; :410
   stack toJSON/fromJSON reserved for F9).
7. `app.on('activate')` sole N-aware seam (:2956).
8. No destroy-free guest detach anywhere — DD1 spike is untested territory.

---

## Leg Progress

### Leg 1: reparenting-spike — landed (2026-07-14)

DD1 spike executed on-platform with a throwaway two-BaseWindow harness
(`/tmp/behavior-tests/goldfinch/f6-spike/` — `spike-main.js`,
`spike-d-main.js`, fixtures; evidence in `evidence/`: paced PNG frames +
JSON transcripts `spike-log-wayland.json`, `spike-log-x11.json`,
`spike-log-question-d.json`). Primary run under `--ozone-platform=wayland`
(the app's real launch config); a second full run on the default x11/
XWayland backend provided REAL WINDOW PIXELS via desktopCapturer window
sources (the F9 cross-platform-control lesson applied). Electron 42.6.1.
No product code; repo byte-identical apart from this log + the leg status.

**The four verdicts:**

1. **DD5 primary path: GO — re-parent.** `removeChildView` →
   `addChildView` across windows with a live page (rAF canvas animation +
   captureStream-fed playing video + scrolled to y=1234): same
   webContents (wcId stable), survives, renders in B, accepts injected
   input (click counter 0→1, mouseWheel scrolls), scroll position intact,
   animation + video advance continuously (~60fps across the swap).
   **Mid-motion visual bar PASSED on rendered pixels**: 104 paced
   surface captures at 17ms cadence (wayland run, zero failures — first
   post-add frame, +12ms, is already fully rendered at B's geometry) and
   54 real-pixel window-frame pairs at 57ms cadence (x11 control — B's
   window shows the guest fully composited in the first frame at/after
   the swap instant; A reverts to bare chrome with NO ghost/zombie
   surface). No white flash, no stale frame, no blank slot in either
   run. Residual: sub-17ms window-composite states are below both rigs'
   sampling floor — covered by DD9's live spec + HAT motion pass.
2. **DD7: ROAM.** A transparent chrome-class view (`setBackgroundColor
   '#00000000'`, sheet-style webPreferences) shown in A, hidden
   (`removeChildView`), attached to B while hidden: survives, stays
   scriptable, renders correctly on next show — x11 window capture shows
   correct transparency composited over the live guest in B. The
   recreate-per-switch fallback is NOT needed. Caveat for the manager:
   never `capturePage` a detached/hidden overlay (see anomaly 1).
3. **DD4 hook: `close` CONFIRMED — with extra margin.** At window
   `close`, guests are alive and `navigationHistory` is fully readable
   (3 entries, activeIndex, canGoBack, titles). Also still readable at
   `closed` AND at closed+100ms: **Electron does not auto-destroy an
   attached WebContentsView's webContents on window close** — teardown
   is entirely ours (DD3's explicit destroy is mandatory, and the
   capture-before-destroy ordering is fully under F6's control).
4. **DD8 focus facts (both backends identical).**
   `BaseWindow.getFocusedWindow()` is NOT null under WSLg — it tracks
   window SHOW: creating/showing a window fires a synthetic `focus`
   event and updates it. But **programmatic `win.focus()` is a no-op**:
   no `focus`/`blur` events fire, `getFocusedWindow()` and
   `isFocused()` stay stale indefinitely (after `winA.focus()`, both
   still report B). DD8's main-tracked last-focused accessor, seeded at
   create AND at programmatic focus, is therefore REQUIRED, exactly as
   designed. Also observed: spontaneous blur/focus flapping on an idle
   window (wayland run, no physical input) — the tracker must simply
   accept latest-event-wins, which it does by design.

**Spike question answers (evidence: transcripts + numbered PNGs):**

- **(guest)** GO, as verdict 1. `q-guest-liveness-across-swap`:
  frameDelta 74/1.2s, videoDelta 1.193s, scrollY 1234 preserved, same
  wcId. Repeated roam B→A→B→B healthy (`q-guest-repeat-roam`).
- **(a)** PASS via the leg's substitute method. Harness: second window's
  chrome gets a distinct wcId (A=1, guest=2, B=3) and is scriptable on
  BOTH axes — act (`executeJavaScript` DOM mutation) and observe
  (readback + `capturePage`), `q-a-second-chrome` +
  `02-chromeB-after-act.png`. Static trace: `resolveContents` resolves
  via injected `webContents.fromId` (a GLOBAL registry, window-agnostic);
  the admin tier's `allowInternal: true` lifts both the internal-session
  and `non-tab-contents` guards (resolve.js:104-116; admin deps built at
  engine.js:55/79, admin engine main.js:792) — so a second chrome (a
  non-tab chrome-class wcId) resolves at admin exactly like the sheet.
  Live precedent cited per leg: tests/behavior/tab-context-menu.md:61-62
  (+ :116) — the sheet probe-walk drives a non-tab wcId via admin
  `evaluate`/`pressKey` in every run. **Residual risk (for leg 2/DD8)**:
  `classifyContents` compares against THE injected chrome singleton, so
  window-2's chrome classifies as `'guest'` until DD8's accessor/
  membership widening lands — any op branching on chrome-vs-guest
  (e.g. foreground-first eval activation) may mistreat it in the interim.
  Already in scope of DD8's `isTabViewWcId`/jar-guard widening; flagged
  so leg 2 verifies the eval-op path explicitly.
- **(b)** PASS. `setBounds` with B's differing content bounds applied at
  adopt lands exactly (bounds == request == captured pixel size); a
  post-adopt `winB.setContentSize` + re-`setBounds` also exact
  (`q-b-setBounds-across-windows`, `05-*.png`, x11 `05-post-resize-*`).
  Bounds are window-local content DIPs; no cross-window coordinate
  surprises.
- **(c)** PASS, as verdict 2 (`q-c-overlay-roaming`,
  `06-overlay-shown-in-{A,B}.png`, x11 `06-overlay-in-B-winB.png`).
- **(d)** `close` confirmed, as verdict 3 (`spike-log-question-d.json`).
- **(e)** As verdict 4 (`focus-sample`/`q-e-*` entries in both logs).

**Anomalies (recorded for legs 2–4 + F7):**

1. **`capturePage` on a DETACHED WebContentsView never resolves** (hangs
   indefinitely; both backends; `q-guest-detached-state`). Any capture
   path that can race a re-parent/hide must timeout-guard — direct input
   to F7's capture semantics, and the reason the DD5 move op should not
   attempt captures mid-swap.
2. **Detached guest pauses rendering but not liveness**: rAF freezes
   (447→447 over 600ms), `document.visibilityState` misleadingly stays
   `'visible'`, webContents stays alive and scriptable; rendering resumes
   immediately on re-attach. With the ~1ms detach→attach in the move op
   this is unobservable; long detachment (roaming overlays) is fine
   because they are hidden by definition while detached.
3. **`show: false` BaseWindow + WebContentsView `loadURL` hang**
   (combined-harness (d) attempt; isolated shown-window run passed
   instantly). Harness-context note; F6 creates windows shown.

Leg ACs: all six questions answered with evidence; verdicts recorded;
repo byte-identical (spike lives in /tmp; `git status` clean of spike
files); leg → landed.

### Leg 2: window-registry-and-routing — landed (2026-07-14)

Registry conversion complete: `src/main/window-registry.js` (new, pure,
Electron-free — win/chromeView injected, identity-compared only) + 13-test
unit suite (`test/unit/window-registry.test.js`); main.js converted from the
four singletons (`mainWindow`/`chromeView`/`tabViews`/`activeTabWcId`) to
per-window records `{win, chromeView, tabViews, activeTabWcId}` keyed by
`BaseWindow.id`. Registry API: `create` (seeds last-focused), `get`, `remove`,
`records`, `size`, `noteFocus` (latest-event-wins, unregistered ids ignored),
`getLastFocused` (membership-validated, first-record fallback — L-c),
`getWindowForChrome(sender)`, `getWindowForGuest(wcId)`, `getChromeForTab(wcId)`,
`isTabViewWcId` (all-windows), `isChromeContents` (any-registered-chrome).

**Census (F5 discipline — derived fresh at implementation start).** Full
classified table in the working notes; digest by conversion class (pre-edit
line refs):

- **Class 1 (sender-resolved)**: window controls :2059-2067 (+`window-is-maximized`),
  dialog parenting choose-download-dir :1440 (zero-param → `(event)`),
  download-media fallback chain :1404 (`_event` → sender record's active-tab →
  chrome), tab-create :2099 (sender record; the :2137 unguarded deref is now a
  guarded `if (!rec) return null`), tab-close/tab-hide/tab-set-active/
  tab-set-bounds (owner-record resolve via `getWindowForGuest`; the :2211
  unguarded deref guarded), sender-identity checks WIDENED to registry
  membership: menu-overlay:open/close :558/:572, find-overlay:open/close
  :2435/:2451, dev-invoke seam :2887 (review F3).
- **Class 1b (window-lifecycle → own chrome via create closure)**: resize/
  maximize/unmaximize → `trigger-send-bounds` + `window-maximized-change`
  through a per-window `sendToOwnChrome`; blur → sheet close kept per-window
  (DD7 conditioning is leg 4); `focus` → `registry.noteFocus`.
- **Class 2 (broadcast)**: `broadcastToChromeAndInternal` :1759 fans to ALL
  registered chromes + internal-session contents once globally.
- **Class 3 (per-tab owner-routed, resolved AT EVENT TIME via a
  `chromeForTab(wcId)` helper)**: the `wireTabViewEvents` fan (sendToChrome
  resolves inside the closure at send time), `zoom-changed` (applyZoom),
  `devtools-state-changed`, `page-context-menu` (owner-null covers the old
  window-gone guard), privacy delivery (`privacy-net` resolved at timer FIRE
  :1592; `privacy-permission` :1734), guest-keystroke forwarders
  (`handleGuestCrossViewNav`/`handleGuestChromeShortcut` now take the guest
  `contents`; guest open-tab/open-find/open-downloads), find-overlay per-tab
  syncs `find-overlay-closed` :2454 / `find-overlay-text` :2481, and the
  review-F1 guest-sender forwarders `tab-media-list` :2495 / `tab-privacy-fp`
  :2503.
- **ACC (DD8 last-focused accessor — the one F2 rule)**: `getChromeContents()`
  redefined over the registry; `getActiveTabContents()` = same record;
  `grabWindow` binds win/chrome/active-tab to ONE record resolved once (F2);
  sheet accelerator + `menu-overlay-activated` + manager closures
  (`getContentView`/`sendToChrome`/`focusChrome`) + downloads retry +
  `internal-open-tab-in-jar` stay on the accessor (interim; DD7 attachment
  scoping is leg 4).
- **Exempt (not window-resolving; keep `_e`/`_event`)**: tab-navigate,
  tab-find, rescan-media (global wcId lookup), fromId-based handlers
  (zoom-apply/get-zoom/print/toggle-devtools/page-context-*/privacy-*),
  settings/shields/clipboard/app-global channels. Grep-AC re-run post-edit:
  every remaining `_e`/`_event` handler audited exempt.

**Lifecycle split (DD3, F8 pinning).** `close`: whole-window capture POINT
wired (body lands leg 3) → roaming-overlay detach guard, find BEFORE sheet
(F8 DD5 pin: find-session close if it targets this window's tabs, overlay
detach if attached here, `closeMenuOverlay('teardown')`) → per-tab suite +
guest destroy per dying guest (forgetTab + removeChildView + destroy — spike
verdict 3: Electron never auto-destroys, explicit destroy mandatory).
`closed`: record removal only. Overlay DESTRUCTION moved to `before-quit`
with the ordering pin traveling (find teardown before sheet close+teardown);
`window-all-closed`/`will-quit` untouched. The chrome webContents is
deliberately NOT destroyed at `close` (see Decisions).

**Find overlay (review F4 — inline derefs, no closure seam).** Converted with
a tracked attachment window (`findOverlayAttachedWin`): show attaches to the
window OWNING the find session's tab (accessor fallback), hide/teardown remove
from the RECORDED attachment (never a hide-time re-resolve — the exact defect
F4 flagged in the sheet manager); `restoreFindOverlay` compares the owner
record's `activeTabWcId`. `lastGuestBounds` stays a single slot (DD7
per-window bounds = leg 4).

**DD8 automation interim.** Engine accessor = last-focused chrome;
`isTabViewWcId` widened to all-windows at BOTH injection sites (MCP getEngine
+ dev-invoke engine — review F3); NEW `isChromeContents` predicate threaded
through engine deps (engine.js:79 bag), scopeCtx → scope.js memberDeps
(jar-tier chrome-exclusion now refuses ANY registered chrome —
resolve.js resolveContentsForJar), resolveContents' non-tab-contents guard
exempts any registered chrome, and `classifyContents` takes the predicate so
every registered chrome classifies 'chrome' (spike residual — the
foreground-first eval activation no longer mistreats a second window's
chrome). getChromeTarget unchanged (accessor's chrome — F7 owns multi-window
semantics).

**Doc enumeration-invalidation answer (AC):** this change invalidates
(1) CLAUDE.md Architecture "Main" bullet — "main.js owns the window shell (a
BaseWindow hosting a chrome WebContentsView; all chrome-renderer access goes
through the getChromeContents() accessor" → now a window REGISTRY of
per-window records; the accessor is the DD8 last-focused interim;
(2) CLAUDE.md "Frameless window" bullet — "Close calls mainWindow.close()" →
sender-resolved record close; (3) CLAUDE.md find-overlay bullet's
"overlayView in main.js" singleton description gains attachment tracking;
(4) docs/mcp-automation.md single-window statements (enumerateTabs/strip ops
now act on the last-focused window; getChromeTarget returns the accessor's
chrome) + the pre-registered listTabs creation-order revisit; README is NOT
yet invalidated (New Window ships leg 4). Full doc refresh lands with leg 5's
grep-ACs.

**Verification.** `npm test`: 1659 pass / 0 fail (13 new registry tests; all
existing suites untouched in meaning). `npm run lint`: clean. `npm run
typecheck`: clean. Live MCP smoke (dev:automation, wayland, admin key via
dev-mint; evidence PNGs in `/tmp/behavior-tests/goldfinch/f6-leg2-smoke/`):
enumerateTabs/openTab/activateTab/closeTab PASS (fixture tab opened wcId 3,
activated, closed; strip consistent); tab-title reaches chrome (navigate →
"Example Domain" in `.tab-title` via chrome evaluate); zoom-changed reaches
chrome (onZoomChanged hook observed `{wcId:3, factor:1.1}` after zoom-apply);
kebab menu opens via chrome evaluate (`openKebabOverlay`, aria-expanded=true,
menu pixel-verified in captureWindow) and dismisses via sheet-side Escape
(probe wcId 4; aria-expanded=false, trigger refocused); find overlay opens
(`openFind`, bar pixel-verified) and closes (overlay-side Escape on probed
wcId 5, bar gone in capture); window maximize IPC + class-1b
window-maximized-change verified (windowIsMaximized false→true→false;
maximize button data-state="maximized"); windowMinimize dispatched, app
responsive after. App log clean of app-level errors (only known WSLg/wayland
platform noise). Electron main then targeted-killed by pid.

Leg ACs: all verified except the live regression TRIPLE (tab-context-menu +
closed-tab-reopen + find-overlay-geometry, specs unmodified) — Witnessed runs
are FD-orchestrated after this landing per the leg-design division of labor.
Leg → landed. Not committed (flight commits once after review).

### Leg 3: stack-and-cache — landed (2026-07-15)

DD4/DD6 landed as line-level ruled. New pure module
`src/main/closed-tab-capture.js` (Electron-free, window-registry precedent)
carries the capture allowlist body both capture sites now share, the
whole-window insertion-order/append-sentinel capture, the `windowId` tag, and
the `reopenStripIndex` pop rule; `src/shared/closed-tab-stack.js` untouched
(entry-shape-agnostic, as ruled).

**DD4.** Tab-close capture tags the owner-resolved window's id (the leg-2
`getWindowForGuest` record). Whole-window capture body filled in at the leg-2
`close`-event capture point: every persist-jar tab in `tabViews` insertion
order, `stripIndex` = append sentinel (-1), the dying window's id; the
`win.destroy()`-skips-`close` accepted edge documented in a comment at the
site; whole block try/catch (capture never breaks close). `tab-reopen` gained
the sender: `stripIndex` is honored iff `entry.windowId` === the invoking
(sender-resolved) window's id, else the sentinel — whole-window entries append
by construction.

**DD6.** New `broadcastClosedTabStackChanged()` pushes
`closed-tab-stack-changed {size}` to ALL registered chromes (chromes-only —
deliberately not the internal-session fan-out, review L1) at every mutation
site: both capture pushes and the reopen pop (the pop broadcasts even when the
safety re-check drops the entry — the stack shrank either way; no clear path
exists today, noted at the helper). Renderer caches via new
`src/shared/push-cache.js` (`createPushCache`): push always wins, the
boot-seed `closed-tab-stack-size` invoke applies only if no push arrived —
monotonic by arrival. `openTabContextMenu` is SYNCHRONOUS (model from the
cache; awaited invoke + `tabCtx.tabId` stale-resolve guard deleted — the F5
known edge is gone structurally; addendum written to the F5 flight log).
Duplicate's `sourceIndex` is now computed AND used inside the snapshot
resolve (no compute-use gap — the staleness sibling closed). Preload gained
`onClosedTabStackChanged` + d.ts declaration; the invoke handler stays as the
boot seed.

**Doc enumeration-invalidation answer (AC):** this change invalidates
(1) CLAUDE.md "Closed-tab stack (M09 F4)" paragraph — capture is now TWO
sites (tab-close + whole-window `close`), entries are windowId-tagged, and
reopen's `stripIndex` is pop-rule-gated rather than returned verbatim;
(2) CLAUDE.md "Tab context menu (M09 F5 Leg 1)" paragraph — "fed by a second
new invoke, `closed-tab-stack-size`" → fed by the DD6 push-cache; the invoke
is the boot seed only; (3) tests/behavior/tab-context-menu.md's "Menu open is
asynchronous (unique to this menu type)" precondition bullet — now stale; the
spec stays PASSABLE unmodified (its poll simply resolves on the first read),
so per the no-spec-edits-mid-flight rule the wording fix waits for the next
spec touch (the FOG step-8 erratum precedent); (4) the F5 flight-log known
edge — addendum line written by this leg. Full doc refresh lands with leg 5's
grep-ACs (leg-2 precedent).

**Verification.** `npm test`: 1679 pass / 0 fail (+20: 14
closed-tab-capture, 6 push-cache; no existing test edited). `npm run lint`:
clean. `npm run typecheck`: clean. Live MCP smoke (dev:automation unpinned —
the app free-fell to port 49709; admin key env-only via command substitution
from the mint line; evidence PNGs in
`/tmp/behavior-tests/goldfinch/f6-leg3-smoke/`): fresh-chrome boot seed
(`closedTabStackSize()` → 0; tab menu omits Reopen — 01-*.png); close a
mid-strip fixture tab → the IMMEDIATELY following right-click's menu already
includes "Reopen closed tab" on the first sheet read, no polling (the old
async opener required a ~1s poll budget per the spec's caveat) — 02-*.png;
`Ctrl+Shift+T` reopen lands the tab back at strip position 1 (same-window
pop rule honored live); the pop's push flips the menu back to omitting
Reopen (03-*.png); Duplicate (the sourceIndex touch) still inserts beside
its source. App log clean of app-level errors. Electron main targeted-killed
by pid; fixture server likewise.

Leg ACs: all verified. Leg → landed. Not committed (flight commits once
after review).

### Leg 4: move-to-new-window — implementation + live feature checks COMPLETE; leg BLOCKED on a discovered conversion-wide window-close hang (2026-07-15)

DD5/DD7 implemented exactly as ruled (all H/M/L pins), suites green (1715
pass / 0 fail, +36; lint + typecheck clean), and the live two-window MCP
check passed EVERY feature observable — but the final teardown-family check
(M4's open→close-a-window leak verification) exposed a **main-process native
hang on ANY window close**, present in the uncommitted leg-2/3 conversion
and NOT caused by this leg (forensics in Anomalies). Per the leg's stop rule
(structural surprise → no improvised mechanism), implementation stands,
leg stays `in-flight`, FD decision required.

**What landed (per AC):**

- **New Window command**: kebab "New window" (first item) + `Ctrl/Cmd+N` —
  `keydownToAction` gains `new-window` (lowercase-only, NOT lightbox-gated,
  app-level like new-tab; Ctrl+Shift+N deliberately unassigned) and
  `sheet-accelerator.js` mirrors it IN THE SAME CHANGE (hand-mirror pin) with
  `autoRepeatGuard: true` (review L1 — windows are heavier than tabs);
  `guest-forward-allowlist.js` adds `new-window` to BOTH kinds (the new-tab
  class), covered by the blanket `!isAutoRepeat` guard (non-`tab-` prefix —
  dedicated unit pin). dispatchChromeAction case invokes the new
  `window-create` IPC (sender-gated by registry membership).
- **`window-boot-config` invoke** (DD5/L4 + H1): joins the renderer's
  boot-gating `Promise.all` (third member; `{bootTab}` default true, invoke
  failure boots normally); preload + d.ts per the declare rule. Serving the
  invoke is the H1 readiness proof — it flushes the record's queued
  adopt-protocol send THUNKS (payloads built at delivery time).
- **Model row**: `tab:move-new-window` in `tab-context-model.js`, duplicate
  section (Chrome adjacency), omitted at `isLastTab` AND `isInternal`
  (M4 ruling; param defaults false — pre-F6 callers unaffected); unit tests
  extended (composition, both omissions, separator invariance, adjacency).
- **Move op** (DD5 steps 1–4 + H1/H2/H3/M2): renderer dispatch sends the
  strip snapshot `{wcId, url, title, favicon, container}` (H2); main
  shape-validates via new pure `src/main/move-tab-payload.js`
  (`validateMoveTabPayload` + `buildAdoptPayload` — main-authoritative
  url/title off the live wc at SEND time; unit-pinned), refuses
  non-sender-owned / trusted / sole-tab targets, closes the find session
  when it targets the moved tab (M2, `refocusGuest:false`), captures guest
  bounds pre-detach + creates the target with the SOURCE content size +
  re-applies bounds at attach (H3; `createWindow({noBootTab, contentSize})`
  — create-chain extension, registry `noBootTab` flag + H1 barrier fields
  unit-tested), re-parents live (`removeChildView`→`addChildView`), moves
  the tabViews entry, updates `activeTabWcId` both sides, seeds last-focused
  via `win.focus()` + `noteFocus`, sends SOURCE `tab-moved-away`
  immediately, queues the target `adopt-tab` + `tab-nav-state` pair per H1.
- **Renderer branches** (M3 factoring): createTab's strip-record
  construction extracted as `buildStripRecord` (tab object + tabs.set +
  button DOM + click/auxclick/contextmenu/pointerdown listeners + append +
  the four title update points), used by BOTH createTab and the new
  module-top-level `onAdoptTab` (direct `tab.wcId` assignment — no tabCreate
  invoke — favicon applied, `activateTab`); `onTabMovedAway` mirrors
  closeTab field-by-field minus stack/IPC — incl. the **activeViewWcId
  clear** (M3's named cross-window bug) and next-activation fallback. Both
  registrations sit ABOVE the boot gate (H1).
- **DD7 roaming overlays — full M1 census**: manager records
  `{contentView, win, bounds}` at show (openMenu receives it from the
  open-sender's record, with that window's CURRENT active-guest bounds —
  per-window bounds fetch); hide/teardown remove from the RECORDED
  attachment (the named re-resolve defect deleted); re-raise show() never
  re-resolves; cross-window model-replace detaches from the old window and
  re-hides find; channel-7, channel-6 forward, and focusChrome all deliver
  to the ATTACHMENT window's chrome (`chromeForAttachment`; a
  gone-attachment send is DROPPED, never re-routed — cross-window token
  spaces collide); sheet accelerator resolves the attachment window's chrome
  + active tab (incl. the find/downloads sends); `tab-set-active`'s
  syncBounds/tab-switch-close/re-raise, `tab-set-bounds`' live syncs,
  `tab-hide`/`tab-close`'s hides+closes, `win.on('close')`'s teardown-close,
  and `win.on('blur')` are ALL conditioned on owner-window ===
  attachment-window (find: session-tab membership / `findOverlayAttachedWin`);
  `showFindOverlay` fetches the owner record's active-guest bounds
  (`entry.view.getBounds()` — the single slot survives as last-resort
  fallback only); `grabWindow` composites overlay layers only when attached
  to the captured window. 9 new manager attachment unit tests.
- **M4 chrome-wc deferred destroy**: implemented at `closed` (`setImmediate`
  — outside the sender's own IPC dispatch), record removed first so no send
  path can resolve the dying chrome. **Live check BLOCKED** (see Anomalies —
  the hang precedes `closed`, so the destroy never gets to run).
- **L1**: sheet `new-window` row autoRepeatGuard pinned; guest-forward
  blanket-guard coverage pinned (`isRepeatSafeAction('new-window')` false).
- Deleted: `getActiveTabContents()` (main.js) — its only consumer was the
  sheet accelerator, now attachment-scoped per DD7.

**Verification.** `npm test` 1715/0 (+36: 12 move-tab-payload, 9 manager
attachment, 2 registry create-chain, and the classifier/allowlist/model
extensions), lint clean, typecheck clean. **Live two-window MCP check**
(dev:automation, wayland, port free-fell to 49709 again — third occurrence;
admin key env-only, derived from the log inside each pipeline; evidence PNGs
in `/tmp/behavior-tests/goldfinch/f6-leg4-smoke/`):

- **Ctrl+N window**: `pressKey(chrome, n+control)` through the real
  classifier → second window, chrome addressable by raw wcId, exactly one
  boot tab, accessor retargeted (enumerateTabs followed); kebab menu opens
  (01-*.png — "New window" first item, roaming sheet in window 2) and
  dismisses via sheet-side Escape (aria false); find bar opens/closes in
  window 2 (02-*.png).
- **Mid-strip move** (background tab, real menu path — contextmenu on the
  tab button + sheet-side item click): target window has EXACTLY the moved
  tab (SAME wcId — re-parent proof), active, no boot tab (03-*.png);
  source closed ranks with active unchanged; `goBack` on the SAME wcId
  landed on the prior history entry (live state intact).
- **Per-channel re-bind sweep** (probes injected into BOTH chromes via
  admin raw-wcId evaluate; every channel exercised post-move):
  tab-loading, tab-did-navigate, tab-nav-state, tab-title, tab-dom-ready,
  tab-did-finish-load, tab-favicon, tab-media-list (goBack-load +
  rescanMedia), tab-did-navigate-in-page (pushState), zoom-changed
  (zoom-apply), devtools-state-changed (toggle on/off — two events),
  tab-privacy-fp (canvas poke), find-overlay-text (per keystroke),
  find-overlay-closed (overlay-side Escape) — **ALL landed in the TARGET
  chrome only, for the moved wcId; the source chrome's probe stayed
  EMPTY**. Pre-adopt tolerance: renderer fan null-guards unknown wcIds
  (findTabByWcId/active-compare — verified present; the H1 queue makes the
  window structurally tiny).
- **Burner move** (ACTIVE-tab move): burner container survived verbatim
  (same synthesized jarId + burner dot "Burner (burner)" in the target
  strip); source fell back to a sane active tab; window-2 activity
  (create + switch) did NOT hide the moved guest in the target window
  (04-*.png — the activeViewWcId fix proven live).
- **Single-tab omission**: sole-tab menu = [Close, Duplicate] — no move row.
- **DD7 cross-window interplay**: window-B tab activity left window-A's
  open menu untouched (aria stayed true — the conditioning); opening B's
  menu superseded A's (A's aria reset via attachment-routed channel 7,
  B's stamped); Escape closed B's cleanly.
- **L4 divergence — live-confirmed**: closing the adopted sole tab in a
  move-created window leaves the window ALIVE with a fresh home tab
  (closeTab's else-createTab branch; Chrome would close the window) —
  accepted this flight, HAT-list carry (05-*.png).
- **Blur/menu interplay across windows**: attempted once (detached-DevTools
  stimulus); WSLg delivered no blur (spike verdict 4 — focus APIs inert).
  UNDRIVABLE on this rig — HAT fallback per the leg's pre-authorization.
  (The conditioning logic itself is unit-pinned + the tab-activity
  non-disturbance was proven live above.)
- **M4 leak live check: BLOCKED** — window close never completes (below).

**Doc enumeration-invalidation answer (AC):** this change invalidates
(1) CLAUDE.md "Keyboard tab-navigation map (M09 F3–F4)" paragraph — Ctrl+N
joins the one-classifier map (and the hand-mirror lockstep example list);
(2) CLAUDE.md Renderer bullet's kebab enumeration ("Settings, Downloads,
Cookie jars, Print…, Exit" → + New window first) and any
`docs/renderer-menu.md` kebab item list; (3) CLAUDE.md "Tab context menu
(M09 F5 Leg 1)" paragraph — the model gains `tab:move-new-window` with the
isLastTab/isInternal omissions, and `tabContextModel`'s param list gains
`isInternal`; (4) CLAUDE.md menu-overlay DD13 accelerator union
description — Ctrl+N rides the chrome-class set; (5) README shortcuts
table + feature list (New window, Move to new window); (6) the a11y
`sheet:kebab` + `sheet:tab-context` audited states now carry one more item
each (allowlist re-baseline only if a new finding appears). Full doc
refresh lands with leg 5's grep-ACs (leg-2/3 precedent).

### Leg 5: verify-integration — AUTHORING PORTION complete (2026-07-15); leg stays in-flight for the FD-orchestrated Witnessed runs

The Developer half of the leg (division of labor per the leg design): the two
new artifacts, the docs refresh, the two wording errata, and the offline
suites. The run half — `multi-window-shell` Witnessed PASS (+ `draft` →
`active`), the single-window regression pair re-run, `npm run a11y`, and the
leg → landed transition — is the FD's.

**Authored:**

- **`docs/behavior-specs-single-window-audit.md` (DD8 deliverable, new).**
  All 46 pre-F6 specs classified per the DD8 taxonomy (probe-walk /
  getChromeTarget / captureWindow / count-precondition / none; multi-class),
  from the recon §8 sweep cross-checked against an exhaustive occurrence
  grep of the corpus: probe-walk 10 and getChromeTarget 33 match the recon
  EXACTLY (the 3 coupled-but-no-getChromeTarget specs resolve to
  `foreground-to-act`, `mcp-auth-gating`, `mcp-jar-scoping` — arithmetic
  closes at 46 = 10 none + 33 + 3); captureWindow marked exhaustively (26
  callers vs the recon's "~18" estimate, corroboration-only usage flagged) —
  the class marks EXPOSURE since the op itself changes meaning under N
  windows; `mcp-auth-gating`/`mcp-jar-scoping` reclassified **tier-contract**
  specs (their only coupling is the admin-only refusal shape F7 must
  preserve). Legs 2–4 updates folded per spec (sync opener, pop rule, DD7
  roaming, the two model-enumeration growths); F7 consumption note enumerates
  the five decisions F7 owes (enumerateTabs scope, getChromeTarget arity,
  captureWindow discriminator, overlay discovery, foreground-to-act
  restatement) + the capture-vs-re-parent race carry and a spec-update
  sequencing order. Specs NOT edited for the audit.
- **`tests/behavior/multi-window-shell.md` (DD9, new; `draft` / Last Run
  `never`).** Nine steps covering every DD9 observable. Step-design judgment
  calls (recorded for the Validator):
  - **Same-wcId discriminator pinned hard** (step 5): the moved tab's
    `enumerateTabs` entry must carry T2's ORIGINAL wcId — the spec text names
    a new wcId as the recreate-fallback signature and an explicit FAIL (the
    spike-gated primary path regressing), per the flight's Adaptation
    Criteria discriminator-flip rule.
  - **Focus-follows is asserted ONLY via the deterministic accessor
    retarget** (`getChromeTarget` returning the new chrome after create/move
    — the DD8 seeding), never OS focus (spike verdict 4: WSLg focus APIs
    inert). Window-chrome discovery likewise rides the accessor retarget
    (create seeds last-focused), so no probe walk is needed for chromes.
  - **close-one-of-N made observable through three independent reads**
    (step 7): shell-side pid liveness + MCP-keeps-answering (the fix-cycle
    hang's exact failure mode), the dead chrome REFUSED as no-such-contents
    (the leg-4 M4 deferred-destroy observable), and accessor stability
    (still C3 — membership validation evicts only closed windows).
  - **Whole-window-capture → reopen made fully provable by seeding the
    move-created window with a SECOND tab** (step 6's `openTab` lands in W3
    via the accessor): closing W3 pushes T2,T3 in insertion order, so the
    survivor's two `Ctrl+Shift+T` pops prove reverse-insertion-order LIFO
    AND the append sentinel (both reopens append; DOM order pinned), and a
    `goBack` on the second reopen proves navEntries fidelity through the
    window-close capture. Window-2's boot-tab capture is bookkept (persist
    jar) so the stack contents stay fully accounted.
  - **The sheet probe walk's skip set is specified as the ALL-windows tab
    census** (recorded per step), because window-scoped `enumerateTabs` is
    no longer a sufficient skip set — the two-window-safe restatement of the
    house idiom, itself an audit finding.
  - **quit-on-last is a shell observable** (step 9): recorded main pid exits
    within ~10 s on its own + the endpoint refuses (not hangs) — pinning the
    no-wedge property the fix-cycle bought.
  - Boot-state bracket after EVERY mint (steps 1/3/5), per the leg-2 carry;
    key hygiene (env-var reference only) in the apparatus precondition.
- **Docs refresh (grep-ACs all hit).** CLAUDE.md: Main bullet rewritten
  around the window REGISTRY + three routing classes + lifecycle split + the
  destroyed-window house rule + last-focused accessor with the F7 pointer;
  kebab enumeration (+New window first); find-overlay + sheet roaming
  attachment tracking (DD7 interim); per-window blur conditioning; DD13
  attachment-scoped accelerator + Ctrl+N; frameless-window close =
  sender-resolved, one-of-N semantics; fan-out = all chromes + internal once
  globally; page-context forward = class-3 owner-routed; listTabs
  creation-order note now points at the audit + F7; keyboard map + hand-mirror
  list gained Ctrl+N (lowercase-only, autoRepeatGuard); closed-tab-stack
  paragraph rewritten (two capture sites, windowId tagging, insertion-order +
  append sentinel, pop rule, push-cache/sync opener); tab-context paragraph
  gained the move row (isLastTab+isInternal omissions, `isInternal` param) and
  the push-cache feed. README: Multiple-windows feature bullet with BOTH
  documented divergences (global reopen pop; sole-tab-close survival), kebab
  bullet, tab-context bullet (+Move to new window), shortcuts table (+Ctrl+N).
  docs/mcp-automation.md: new "Multi-window semantics (interim — M09 F6)"
  section (last-focused accessor semantics, enumerateTabs window-scoping,
  raw-wcId cross-window reach, captureWindow two-window caveat, audit
  pointer) + the three tool-reference rows annotated. Grep-ACs:
  `grep -n "window registry" CLAUDE.md` ✓ (:21),
  `grep -n "Ctrl+N\|Move to new window" README.md` ✓ (5 hits),
  `grep -n "last-focused" docs/mcp-automation.md` ✓ (7 hits).
- **The two wording-only errata** (no Expected Result's substance changed):
  tab-context-menu.md's async-opener precondition bullet → synchronous
  (DD6), with the steps' poll budget retained as an explicitly-scoped
  cross-view-IPC robustness note (the Intent's matching "async model build"
  parenthetical updated in the same stroke — the same stale statement in a
  second location); find-overlay-geometry.md step-8 "fresh/reset" → "query
  re-seeded and fully selected" (the designed chrome-held findText behavior
  the 2026-07-15 run observed), step label "reset-on-next-open" →
  "re-seed-on-next-open" for coherence.

**Verification (authoring scope).** `npm test`: 1715 pass / 0 fail (no test
touched — docs/specs only). `npm run lint`: clean. `npm run typecheck`:
clean. No product source changed by this leg portion. `npm run a11y` +
the live runs are the FD's half.

**⚠️ FLAG for the FD (pre-run):** the flight-end regression re-run of
`tab-context-menu` (spec unmodified) will hit a **deliberate product-growth
vs exact-enumeration conflict at Step 3**: leg 4's `tab:move-new-window` row
is PRESENT for that step's five-tab background-tab menu, so the step's
"items EXACTLY: Close, Close other tabs, Close tabs to the right, Duplicate"
list is stale-by-one against the live menu (Step 9 is unaffected —
`isLastTab` omits the row). The spec's own Out of Scope anticipated exactly
this addition ("deliberately absent from the model until the multi-window
flights add it"). This is not a conversion regression (the invariant class
the pair re-run exists to prove) but feature growth the F5-era spec predates;
an item-list spec update is outside this leg's wording-only edit budget, so
it needs an FD ruling at run time (judge Step 3 against the model rules and
queue the spec touch, or update-then-run). Recorded in the audit's
tab-context-menu row as well. The same growth makes any EXACT kebab item
read stale-by-one (`kebab-menu.md` — not in the re-run pair; audit row
flagged).

Leg spec set `ready` → `in-flight`. Not committed (flight commits once after
review).

---

## Decisions

### Leg 2 — chrome webContents not destroyed at window `close`
**Context**: DD3 says "destroy guests, null the chrome". Destroying the chrome
wc at `close` would run synchronously inside the chrome's own `window-close`
IPC dispatch (destroy-sender-inside-own-dispatch is a known crash-risk
pattern), and today's single-window baseline never destroys it before quit.
**Decision**: guests are explicitly destroyed at `close` (mandatory — spike
verdict 3); the chrome reference drops with the record at `closed`, wc
destruction left to process teardown. **Impact**: byte-identical single-window
behavior; with N windows a closed window's chrome renderer lingers until quit
— flagged for leg 4/F7 to revisit (e.g. deferred destroy) when a second
window becomes closable in practice.
**Leg-4 update (M4, 2026-07-15)**: the deferred destroy LANDED — a closed
window's chrome wc is destroyed via `setImmediate` at `closed` (outside the
sender's own window-close IPC dispatch, per this note's crash-risk
rationale; the record is removed first so no send path can resolve the
dying chrome). Its live verification is BLOCKED by the window-close native
hang (leg-4 Anomalies): the hang precedes `closed`, so neither the old
linger nor the new destroy is currently observable live. Re-verify with the
hang fix.
**Fix-cycle update (2026-07-15)**: hang fixed (the win.id-at-`closed` throw —
see the leg-4 Anomalies resolution); the deferred destroy is now
LIVE-VERIFIED both main-side (webContents count returns exactly to baseline
after close) and via MCP (the closed window's chrome wcId refused as
`no-such-contents`).

### Leg 2 — find-overlay attach is owner-of-session routed with attachment tracking
**Context**: the leg AC required converting the overlay's inline `mainWindow`
derefs; review F4's rationale (never remove from a re-resolved parent) applies
to hide/teardown. **Decision**: show resolves the window OWNING
`findOverlayTabWcId` (accessor fallback) and records it in
`findOverlayAttachedWin`; hide/teardown remove from the recorded attachment.
A minimal forward-slice of DD7's attachment tracking, not the full roaming
conversion (bounds/blur/accelerator scoping stay leg 4). **Impact**:
single-window identical; leg 4 builds on the tracked attachment.

### Fix-cycle — destroyed-window property access is forbidden in lifecycle handlers
**Context**: the leg-4 window-close hang root-caused to `registry.remove(win.id)`
at `closed` — BaseWindow property access throws `"Object has been destroyed"`
once the native window is gone, and an uncaught throw inside the `closed`
emission both aborts the listener chain (so `closed` appears to never fire)
and wedges Electron's native close sequence on Wayland into a permanent,
silent event-loop starvation (the leg-4 BLOCKER; full forensics + method in
the Anomalies resolution). **Decision**: window ids consumed by lifecycle
handlers are captured while the window is alive (`const winId = win.id` in
`createWindow`); the `closed` handler and the `focus` listener use the
captured id. House rule for F6 onward: never read `win.*` in `closed`-or-later
handlers — capture teardown inputs at create time. **Impact**: window close
completes on every path (one-of-N, sole window, quit); the M4 deferred chrome
destroy now runs (live-verified — wc count returns to baseline); the leg-2/3
first-SIGTERM-survives anomaly is explained and gone; leg-4's M4 live check
and the flight's close-one-of-N criterion (leg 5) are unblocked.

### Leg 3 — pure logic extracted into two new modules
**Context**: the leg's unit ACs demand offline coverage of the capture-order/
sentinel/windowId/pop-rule logic and the seed/push race, but main.js and
renderer.js are not unit-loadable, the stack module is ruled untouched, and
`@ts-check`'s excess-property rule would reject a windowId-bearing literal
against the stack's F4 entry typedef at the call sites anyway.
**Decision**: `src/main/closed-tab-capture.js` (CJS, Electron-free — the
window-registry precedent) owns capture + pop rules and the tagged entry
typedef; `src/shared/push-cache.js` (ESM — the tab-context-model precedent)
owns the seed/push race rule, imported by the renderer. **Impact**: both
capture sites share one allowlist body (tab-close's inline block replaced);
the race rule is unit-pinned rather than prose-only.

---

## Deviations

### Leg 2 — classifyContents widening touched four files beyond the leg's list
**Planned**: automation changes scoped to resolve.js / engine.js / scope.js
(+ main.js wiring). **Actual**: observe.js, input.js, print.js, find.js also
edited — mechanically, to pass the new optional `isChromeContents` predicate
into their `classifyContents(wc, chromeContents, isChromeContents)` calls (+
JSDoc deps keys). **Reason**: an identity compare against ONE injected
contents cannot recognize N chromes; the AC's "classifyContents recognizes
every registered chrome" requires the predicate at each call site. Absent
predicate = old behavior, so existing unit suites needed no edits.

### Leg 2 — main.js grew instead of holding (+~170 lines, 2994 → 3166)
**Planned**: "net-neutral or shrinking via extraction". **Actual**: the
registry extraction moved state out, but the DD3 per-window close suite,
routing-class comments, and sender-resolution scaffolding net-added lines.
**Reason**: the census-mandated per-site conversion is comment-heavy by house
style; no logic duplication was introduced (verified via the census table).

### Leg 4 — one file beyond the leg's Files Affected list (plus its test)
**Planned**: the leg's Files Affected enumeration. **Actual**: also
`src/main/move-tab-payload.js` (new, pure, Electron-free) with
`test/unit/move-tab-payload.test.js`. **Reason**: the leg's own unit AC
("any pure extraction (e.g. adopt payload builder)") — main.js is not
unit-loadable, and the H2 shape rules (favicon/container renderer-only;
url/title main-authoritative at send time) needed offline pins. The
closed-tab-capture/window-registry precedent.

### Leg 4 — getActiveTabContents deleted from main.js
**Planned**: no deletion named. **Actual**: the DD8 last-focused active-tab
accessor was removed. **Reason**: its ONLY consumer was the sheet
accelerator, which DD7 re-scoped to the ATTACHMENT window's active tab; an
unused accessor would fail lint and misleadingly advertise an ownerless
active-tab rule leg 5/F7 should not reach for.

### Leg 3 — two files beyond the leg's Files Affected list (plus their tests)
**Planned**: main.js, renderer.js, preload + d.ts, test/unit, the two logs.
**Actual**: also `src/main/closed-tab-capture.js` and
`src/shared/push-cache.js` (new), with `test/unit/closed-tab-capture.test.js`
and `test/unit/push-cache.test.js`. **Reason**: the extraction Decision above
— the AC's "unit-covered where the logic is pure" is not satisfiable inside
the listed files.

---

## Anomalies

### Leg 2 — first SIGTERM to the electron main pid did not terminate it
**Observed**: at smoke teardown (window minimized at the time, WSLg/wayland),
the first `kill <pid>` left the process alive ~6s; a second SIGTERM exited it
cleanly. **Severity**: cosmetic (smoke-rig observation; no code path
implicated — quit hooks are synchronous and the process exited normally on
the retry). **Resolution**: noted for future smoke teardowns; not attributed
to the leg's changes without a control (the F9 rig-attribution lesson).
**Fix-cycle update (2026-07-15)**: attributed after all — same mechanism as
the leg-4 window-close hang (win.id-at-`closed` throw wedging the quit path);
gone with the fix (single SIGTERM now exits in ~1s — see the leg-4 Anomalies
resolution).

### Leg 4 — BLOCKER: window close hangs the main process (conversion-wide, pre-existing in the uncommitted branch; NOT leg-4-caused)

**Observed**: closing ANY product window on this branch — one-of-two OR the
sole window, via the window-close IPC (`win.close()`) — runs the `close`
handler to completion, then **`closed` never fires and the main-process JS
event loop starves permanently** (setImmediate callbacks stop running, the
MCP http server stops accepting — backlog fills, log goes silent; process
state S, main thread parked in poll — a native nested-pump wait, not a JS
spin). The window stays on screen. This also RETRO-EXPLAINS the leg-2/3
teardown anomaly (first SIGTERM survived, second worked): the quit path
runs the same close sequence and presumably wedges the same way until the
second signal forces exit — now three-plus occurrences with a mechanism.

**Forensics (all on wayland/WSLg, breadcrumb-instrumented close/closed
handlers, then reverted)**:
1. Close handler completes fully (capture → overlays → guest
   destroy loop → exit breadcrumb); hang is strictly between the `close`
   event returning and `closed`.
2. NOT leg-4's deferred chrome destroy — reproduces with it disabled (it
   runs at `closed`, which is never reached).
3. NOT the guest destroys / removeChildView inside `close` — reproduces
   with the whole per-tab suite deferred to setImmediate (which then never
   runs), AND with the chrome view also detached at `close`.
4. NOT the close-handler body at all — reproduces with a **no-op close
   handler** (immediate return; no capture, no teardown, no destroys).
5. NOT frameless-specific — reproduces with a framed window.
6. NOT the platform/rig — a control worktree at HEAD (pre-conversion
   `01ebc25`, the flight/5 landing) closes + quits cleanly under the
   IDENTICAL launch + drive pattern. The defect is introduced by the
   uncommitted F6 conversion (legs 2–3 lifecycle wiring and/or leg-4's
   window plumbing OUTSIDE the close path), and was unobservable until now
   because no smoke ever closed a window (teardowns were targeted kills;
   the leg-1 spike closed windows cleanly, but its harness predates the
   conversion's per-window wiring).
7. Not attributable to the automation apparatus: reproduces with the close
   scheduled via `setTimeout` renderer-side (no in-flight eval at close
   time).

**Severity**: HIGH — blocks leg-4's M4 live check, the flight's
close-one-of-N criterion (leg 5's `multi-window-shell` spec), and real
window-close UX. **Resolution**: per the leg's stop rule, no mechanism was
improvised; leg 4 stops here with implementation + all feature checks
complete. Suggested next step (FD): a dedicated fix-cycle/spike bisecting
the conversion's per-window wiring (candidate suspects: the `close`/`closed`
listener pair's mere presence interacting with Wayland teardown, the
per-window `blur`/`focus`/`resize`/`maximize` listener set, or destroy-time
interaction with a second live window's compositor state), with the
breadcrumb + control-worktree method above (evidence:
`/tmp/behavior-tests/goldfinch/f6-leg4-smoke/` — app-run1.log, control.log).

**RESOLUTION (2026-07-15, fix-cycle investigation): ROOT-CAUSED AND FIXED.**

*Root cause*: `registry.remove(win.id)` in the per-window `closed` handler
(main.js `createWindow`) reads `win.id` on the already-DESTROYED BaseWindow.
Destroyed-window property access throws `"Object has been destroyed"`; the
uncaught throw inside the `closed` emission — a native→JS callback in the
middle of Electron's window-destruction sequence — (a) aborts the listener
chain, so no later-registered listener ever observes `closed`, and (b) wedges
the native close path on Wayland: the main-process event loop starves
permanently, with ZERO error output anywhere (the exception never reaches any
reporter). Introduced by leg 2's lifecycle split (the singleton `closed`
handler it replaced touched no window property).

*Why the leg-4 forensics pointed away from it*: every exclusion was correct —
close-handler body, teardown suite, framing, platform were all innocent; the
no-op-CLOSE-handler run still hung because the defect lives in the CLOSED
handler, and the throw itself manufactured the "`closed` never fires"
evidence (the aborted emission hides the handler's own execution from any
late-registered breadcrumb listener).

*Method*: differential bisect per the suggested plan — control worktree at
HEAD + a main-side probe driver (close + `closed` listener + heartbeat);
full conversion HANG / control CLEAN; renderer+preload+shared+automation
reverted → still HANG (main-side); per-listener env gates → `closed`-handler
body guilty; per-statement gates → `registry.remove(win.id)` guilty; a
try/catch breadcrumb then caught the throw red-handed
(`[BC] win.id THREW: Object has been destroyed` — and with the throw
swallowed, the hang vanishes entirely).

*Fix (minimal, two lines + comments)*: capture `const winId = win.id` at
create time in `createWindow` and use the captured id in the `closed` handler
(and the `focus` listener). Rule going forward: never dereference `win.*`
inside `closed`-or-later handlers — capture what teardown needs while the
window is alive.

*Verification*: `npm test` 1715/1715, lint clean, typecheck clean. Live
main-side probe (wayland/WSLg): second window closed → `closed` fires (a
late-registered listener sees it), event loop alive (heartbeat continues),
**M4 deferred chrome destroy CONFIRMED** (webContents count returns exactly
to baseline), last-window close quits the app cleanly. Live MCP run
(dev:automation, pinned port, admin key env-only): window-create → window 2
addressable (accessor follows); **one-of-two window-close via the real
`window-close` IPC → MCP keeps answering** (the exact pre-fix failure mode),
accessor falls back to window 1, the closed window's chrome wc refused as
`no-such-contents` (M4 live); full open→move-to-new-window (same wcId adopted
in the target strip)→close-source cycle clean, whole-window capture ran
(stack size 2); last-window close → clean quit, process exit 0. Single
SIGTERM to the electron main pid now exits in ~1s — the leg-2/3
first-SIGTERM-survives anomaly was the same wedge on the quit path and is
gone. Scratch worktrees removed; probe instrumentation reverted; no key
material in any file or command literal.

### Leg 4 — toggleDevtools invoke returned false while devtools-state-changed fired
**Observed**: during the re-bind sweep, `toggleDevtools({webContentsId})`
resolved `false` on both calls, yet `devtools-state-changed` fired twice
(open + close) and routed correctly. The invoke's post-toggle
`isDevToolsOpened()` read appears to lag detached-DevTools state under
WSLg. **Severity**: cosmetic (the live event — what the button actually
consumes — is correct; pre-existing behavior class, not touched by this
leg). **Resolution**: noted; no action this flight.

### Leg 3 — SIGTERM recurrence + automation port free-fallback in the smoke rig
**Observed**: (1) the leg-2 teardown anomaly REPRODUCED — first SIGTERM to the
electron main pid survived ~2s, second exited cleanly (window NOT minimized
this time, weakening leg 2's minimized-window hypothesis; still WSLg/wayland);
(2) the app launched unpinned and free-fell to port 49709 — something on this
host held 49707 (connects TIMED OUT rather than refused; no electron process
was listening there). The product fallback behaved exactly as documented; the
smoke client followed via `GOLDFINCH_MCP_PORT` (client-side endpoint
composition only). **Severity**: cosmetic, rig-side both. **Resolution**: two
observations now for the SIGTERM pattern — worth a control experiment if it
recurs a third time (F9 rig-attribution lesson); port noted for future rigs.
**Fix-cycle update (2026-07-15)**: SIGTERM pattern root-caused with the leg-4
window-close hang (same wedge on the quit path) and gone with the fix — see
the leg-4 Anomalies resolution.

---

## Session Notes

### Flight Director Notes

- 2026-07-14 — Flight designed autonomously (operator pre-authorization);
  recon agent swept main.js/automation/renderer/spec corpus (fact base
  above). Six pinned questions from the F4/F5 debriefs resolved as flight
  Open Questions — per-window-vs-global stack decided GLOBAL-TAGGED
  (whole-window capture needs entries to outlive their window; F9 groups
  by windowId), module split decided TWO-PART (registry extraction in F6;
  renderer per-menu split to a post-mission maintenance flight), opener
  sync-ification via push-cache adopted (F5 known-edge fold-in).
- Design review pass 1 (2026-07-14): **approve-with-changes**. The decision
  set stood (global-tagged stack, push-cache, registry extraction, roaming
  interim, spike gate, audit deliverable). Findings folded into the spec:
  - **H1**: DD2 was missing its third routing class — per-tab main→chrome
    pushes must route to the tab's OWNING window's chrome at EVENT TIME
    (`getChromeForTab`), never fan out, never sit on a focused-window
    accessor; DD5's adopt re-bind is a consequence of event-time
    resolution, verified per channel. Guest/sheet sender resolution named.
  - **H2**: whole-window capture moved to the `close` event (guest
    liveness at `closed` unverified — spike item (d)); strip order for
    whole-window entries resolved as insertion order + append sentinel
    (per-entry stripIndex is dead weight — the origin windowId can never
    match at pop time; L2 folded in).
  - **M1/M2**: DD7 gained attachment tracking (hide removes from the
    RECORDED attachment, never a hide-time re-resolve), per-window bounds
    fetch at show, blur conditioned on attachment window, accelerator
    scoped to attachment window, and a recreate-per-switch fallback; spike
    gained overlay-class roaming (c).
  - **M3**: DD8's accessor changed from focused-window to main-tracked
    LAST-FOCUSED (seeded at create + programmatic focus) — WSLg focus
    APIs may never fire for automation runs; spike item (e); DD9 gained
    the window-2-via-raw-wcId-only spec constraint (captureWindow's
    best-size heuristic can mis-pick).
  - **M4/M5**: adopt payload decisions (full container object — burners
    movable; internal tabs omitted from the model row; post-adopt
    tab-nav-state push; named lost/re-derived state) and the close-path
    per-tab side-effect suite (forgetTab, find-session close, roaming
    detach).
  - **L1–L5**: seed/push race rule (push wins); fan-out delivers to
    internal-session once globally; `_event` grep-AC; window-boot-config
    invoke transport; jar-guard chrome-exclusion widened in F6 (F6 widens
    isTabViewWcId membership, so F6 owns the guard).
  - Leg 2 split per review (registry-and-routing / stack-and-cache) —
    five legs total.
  Substantive changes → pass 2 review next per house rule.
- Design review pass 2 (2026-07-14): **approve-with-changes → approved
  after textual fold-ins**. All pass-1 resolutions verified against the
  code (manager hide-time re-resolve confirmed real; no `close` handler
  exists today; boot-gating Promise.all confirmed). Six textual findings
  folded: M-a (`_e` OR `_event` in the grep-AC — main.js's dominant
  convention is `_e`), L-a (class 1b: window-lifecycle events → own
  chrome), L-b (OQ ¶3 aligned to DD4's insertion-order/append ruling),
  L-c (accessor validates registry membership at read), L-d (overlay
  teardown ordering pin travels to quit hooks), L-e (pre-adopt push
  tolerance in the per-channel re-bind verification). No decision changed;
  no third cycle warranted. Flight `planning` → `in-flight`
  (2026-07-14); branch `flight/6-multi-window-1` stacked on flight/5.
  Proceeding to leg 1 (`reparenting-spike`).
- 2026-07-14 — Leg 1 landed: spike full GO (re-parent primary path; roam;
  `close` hook; DD8 focus facts confirmed). Two carries: `capturePage` on
  a DETACHED WebContentsView never resolves (F7 capture-semantics input —
  any capture racing a re-parent needs a timeout guard); sub-17ms
  composite states are below both capture rigs' sampling floor (residual
  for DD9's live spec + the HAT motion pass).
- 2026-07-14 — Leg 2 (`window-registry-and-routing`) designed. **Risk
  tier: HIGH** (state-machine/lifecycle conversion + shared automation
  interface — the mission's M05-scale leg). Per-leg design review ran two
  cycles: pass 1 approve-with-changes (F1 media/privacy forwarders missing
  from class 3 — leg 4's adopt lost-state ruling depends on them; F2
  grabWindow/getActiveTabContents disposition; F3 dev-invoke seam + second
  isTabViewWcId site; F4 find-overlay has NO closure seam — inline derefs,
  the AC's original wording pattern-matched a nonexistent construction;
  F5-F9 census discipline/blind spots/regression triple/close-closed
  pinning/files); pass 2 verified all fold-ins, approved. Leg → ready.
  Witnessed regression triple will be orchestrated by the FD after the
  Developer lands implementation + suites + smoke (division of labor: the
  Developer cannot run Witnessed protocol).
- 2026-07-15 — **Leg 2 regression triple: ALL THREE REPRODUCE** (specs
  unmodified; regression mode — fresh Executor batched + fresh Validator
  single-pass per spec): `tab-context-menu` 10/10
  (runs/2026-07-15-01-40-14), `closed-tab-reopen` 9/9
  (runs/2026-07-15-01-51-04), `find-overlay-geometry` all required
  checkpoints on inspected pixels (runs/2026-07-15-02-09-30). The
  single-window invariant AC is proven. FOG surfaced a NEW apparatus
  caveat (WSLg Wayland maximize lag-by-one — codified in its run log +
  spec header) and a step-8 wording erratum (query re-seeds with
  select-all — the designed behavior; wording fix on next spec touch).
- 2026-07-15 — **Anomaly triaged and cleared**: the FOG run booted with
  TWO startup tabs. Triage (8 fresh launches on this branch + 8 on the
  parent commit via worktree: 0/16 reproduce) + forensics (profile
  history.db shows the second tab created 69 SECONDS after boot with the
  exact `new-tab`-action shape; the Executor's transcript shows zero
  app calls in that window) → **environmental contamination** (stray
  physical input into the live idle window on the WSLg desktop during
  the setup lull), NOT the conversion, NOT a pre-existing flake. No
  invariant violation — the registry handled the extra tab correctly.
  Validator had independently confirmed zero checkpoint contamination.
  **Carries adopted**: (1) Executors bracket boot state — snapshot
  enumerateTabs immediately after mint, before any setup lull
  (AUTHORING.md candidate, mission-debrief carry); (2) key hygiene — one
  executor pasted the admin key into a command line (persists in that
  local agent transcript; key is per-launch dev-minted and DIED with the
  app teardown, so no live exposure) — reinforce env-var-reference-only
  in executor prompts.
- 2026-07-15 — Leg 2 CLOSED (landed; all ACs incl. the invariant proven).
- 2026-07-15 — Leg 3 (`stack-and-cache`) designed. **Risk tier: LOW** —
  DD4/DD6 are line-level pre-adjudicated by the two-pass flight review
  (capture hook + order sentinel + pop rules + seed/push race all ruled);
  the capture body REUSES the tab-close idiom; the opener change REVERTS
  to the sync shape every other opener has. No per-leg design review;
  flight-end Reviewer covers the code.
- 2026-07-15 — Leg 4 (`move-to-new-window`) designed. **Risk tier: HIGH**
  (new cross-window protocol + manager API change + both classifier
  copies). Two review cycles: pass 1 approve-with-changes — three HIGHs
  in the construction-path class (H1 adopt-message readiness barrier —
  a send to a pre-boot chrome document is silently dropped; H2 the
  wcId-only invoke cannot construct burner containers or favicons — the
  payload must be the SOURCE RENDERER's strip snapshot; H3 the re-parent
  geometry gap needs the spike's seed-bounds-at-attach adapted to the
  product path) + M1 full attachment-scope census (eleven sites, not
  four), M2 find-session-on-move, M3 the createTab factoring named
  (strip-record-construction helper) + the activeViewWcId cross-window
  bug, M4 the leg-2 chrome-wc deferral lands HERE (deferred destroy),
  L1–L4 pins. Pass 2 verified all fold-ins, approved. Leg → ready.
- 2026-07-15 — Leg 4 BLOCKER resolved and leg CLOSED (landed). The
  window-close hang was root-caused by a dedicated investigation
  (differential bisect, HEAD control worktree): `registry.remove(win.id)`
  in the per-window `closed` handler read a property on the already-
  DESTROYED BaseWindow — the throw inside the native→JS `closed` emission
  aborted the listener chain (manufacturing the "closed never fires"
  evidence) AND wedged the Wayland close path into permanent event-loop
  starvation. Introduced by leg 2's lifecycle split; the leg-4 no-op
  CLOSE-handler exclusion was correct-but-misleading (wrong handler).
  Minimal fix: capture `winId` at create; handlers use the captured id.
  Verified: 1715/1715 + lint + typecheck; closed fires; loop alive; M4
  deferred chrome destroy to baseline (4→2); close-one-of-N with MCP
  still answering; whole-window capture ran on the source close (stack
  +2); last-window close → clean quit; single SIGTERM now exits in ~1s
  (the leg-2/3 teardown anomalies were the SAME wedge — explained, gone).
  New Decisions entry: destroyed-window property access is forbidden in
  lifecycle handlers (capture ids at create). All leg-4 ACs now verified
  including the two previously blocked.
- 2026-07-15 — **FD ruling (leg 5): designed-change spec updates.** Leg 4's
  `tab:move-new-window` row made two ACTIVE specs' exact enumerations
  stale-by-design: `tab-context-menu.md` step 3 (updated by FD — the row
  added to the pinned list with an annotation; step 9 unaffected,
  isLastTab omission) and `kebab-menu.md` (header STALE-ENUMERATION
  annotation only — its pins were ALREADY stale by "Cookie jars" from a
  pre-F6 flight, so the full-body refresh exceeds F6's budget; must be
  folded before that spec's next run). Rationale: leg 2's
  "specs unmodified" invariant proved the CONVERSION was
  behavior-identical; legs 3–4 deliberately changed designed composition
  — re-running against knowingly-stale Expected Results would
  manufacture a false FAIL, and silently passing a stale spec would be
  worse. Both updates recorded in the audit artifact rows.
- 2026-07-15 — **Leg 5 verification complete; leg CLOSED (landed).** FD-run
  portion: `multi-window-shell` first-run discipline — run 1
  (2026-07-15-05-32-46) was product-green on every step intent but
  surfaced three spec errata (step-2 openTab→navigate commit race left a
  1-entry history, making step 6's history-survival claim unproven;
  step-3 boot-census settle; foreground-first read order); errata folded,
  FULL fresh re-run ordered (the F1 precedent) — run 2
  (2026-07-15-05-54-21) **PASS 9/9 with no repairs**, history survival
  proven on the same wcId; spec `draft` → `active`. Flight-end regression
  pair: `tab-context-menu` 2026-07-15-06-05-04 **10/10**
  (REPRODUCES-with-designed-deltas — the Move-to-new-window row present
  multi-tab and isLastTab-omitted sole-tab; sync opener corroborated
  first-poll-present; stale Out-of-Scope bullet fixed post-run);
  `closed-tab-reopen` 2026-07-15-06-19-34 **9/9** (REPRODUCES; 6-item
  kebab = designed growth; step-8 synthetic-Enter non-activation = the
  documented F8 apparatus nuance, re-driven by click, no new note needed
  per Validator). `npm run a11y` green (sheet:tab-context swept, no new
  violations); suites 1715/1715 + lint + typecheck green.
  **Carries for the debrief**: the deterministic
  `navigationHistory.restore rejected: ERR_ABORTED` log line (once per
  MWS run at the multi-entry reopen, end states correct — benign-with-
  carry; codify an expected count in MWS step 8 on next spec touch; HAT
  eye); the port-pin "in use despite ss-free" launch-script quirk (2/2
  reproducible → tooling note); kebab-menu.md still needs its full-body
  enumeration refresh before its next run (header-annotated).
- 2026-07-15 — **Flight-end review: `[HANDOFF:confirmed]`, no issues
  (blocking or non-blocking).** Session resumed at Phase 2d on operator
  instruction to finish the flight and debrief autonomously; state verified
  consistent first (five legs `landed`, checkboxes ticked, flight
  `in-flight`, no project-defined transition side-effects). One Reviewer
  spawn (Sonnet per crew file), scoped to the whole uncommitted flight —
  tracked diff AND the untracked new modules, which are the core of the
  flight and easy for a `git diff`-only reviewer to miss (named explicitly
  in the spawn). The review was pointed at the flight's own hard-won risk
  areas rather than left generic: the destroyed-window deref rule as the
  headline check (sweep EVERY lifecycle handler, not just the fixed site),
  event-time routing, membership-validated accessor, recorded-attachment
  hide, cross-window leaks. All came back clean — the deref sweep found no
  surviving unguarded access (every other `.win.` deref is either a
  provably-alive synchronous read mid-IPC-handler or `isDestroyed()`-guarded),
  and the recorded-attachment defect class was verified absent in both the
  sheet manager and the find overlay. Suites re-run by the Reviewer
  independently: 1715/1715 pass (13 suites), lint clean, typecheck clean.
  No fix cycle needed. Proceeding to commit. Log Summary — a stale
  "flight in planning" placeholder that survived the whole flight — rewritten
  by the FD at the same time.
- 2026-07-15 — **Flight landed. `[COMPLETE:flight]`** Single flight commit
  `21a5182` (55 files, +5608/-423 — the whole flight: code + artifacts +
  specs + run logs + audit). All five legs `landed` → `completed`, flight
  `in-flight` → `landed`, F6 checked off in the mission. PR
  [#89](https://github.com/msieurthenardier/goldfinch/pull/89), based on
  `flight/5-tab-context-menu` per the mission's stacking pattern — "Code
  merged" stays UNTICKED in the Post-Flight checklist; the operator merges
  the stack. Debrief follows.
- 2026-07-15 — **Debrief complete; flight `landed` → `completed`.** Two crew
  interviews (Developer + Architect, spawned in parallel — independent by
  design). Human interview SKIPPED: the log is comprehensive and the operator
  authorized autonomous completion; no gaps worth a blocking question.
  Both interviews converged independently on the same structural finding, and
  it is the most valuable thing this flight produced: **the destroyed-window
  rule is not enough — the class should be made unrepresentable.** The
  registry's API was already correct (`remove(winId)` takes a primitive); the
  gap is the raw-Electron-event boundary that calls it. An `onWindowClosed`
  wrapper capturing at registration time (while the window is alive) and
  handing the callback only primitives makes the mistake unwritable; an
  ESLint `no-restricted-syntax` selector complements it where the wrapper
  isn't used. The rule has already slipped past two design reviews, a full
  unit suite, and three passing specs once, and F7 adds MORE lifecycle
  surface. Also converged: prose design review is structurally blind to
  implementation-fidelity defects (all three passes' findings are in the
  "design is incomplete" register — "line 1209 will throw" is unreachable
  from there); the spike asked nine questions and missed the one that
  mattered (guest liveness at `closed` verified, container BaseWindow never
  asked about); and targeted-kill teardown hid the close path for two legs.
  Architect's independent catch: the leg-2 Deviations entry (main.js "2994 →
  3166") went stale — landed count is 3461, so main.js has now passed the
  size that triggered the RENDERER's scheduled split and never had a target
  of its own. Test metrics: 1715/1715, 13 suites, ~1.11s, zero
  skips/flakes; +69 vs F5 reconciles leg-by-leg (13+20+36+0); wall-clock flat
  across F4/F5/F6, corroborating the M06 F3 startup-dominates finding.
