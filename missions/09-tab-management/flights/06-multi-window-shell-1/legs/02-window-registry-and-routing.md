# Leg: window-registry-and-routing

**Status**: completed
**Flight**: [Multi-Window Shell, Part 1](../flight.md)

## Objective

Convert main.js from the single-window singletons to the window registry
with the three-class routing model (flight DD2), the lifecycle split
(DD3), and the automation accessor interim (DD8's last-focused rule +
membership widening) — with the hard invariant that ONE window open means
byte-identical behavior (the single-window regression triple must pass
unmodified). This leg does NOT create a second window through any user
surface (that's leg 4); it makes the machinery N-window-correct.

## Context

Flight DD2/DD3/DD8 are authoritative and embed the two-pass design-review
rulings verbatim — read them fully before coding, plus the flight log's
recon fact base (singleton census, ~30-site send census, surprises) and
the leg-1 spike findings (guests alive at `close`/`closed`;
`getFocusedWindow` stale on programmatic focus — the seeded tracker is
mandatory; `classifyContents` compares against THE chrome singleton —
window-2's chrome would classify 'guest' until the widening lands).

## Acceptance Criteria

- [x] `src/main/window-registry.js` (new) + unit suite: record shape
      {win, chromeView, tabViews, activeTabWcId}; create/get/remove/
      iterate; `getWindowForChrome(sender)`, `getWindowForGuest(wcId)`,
      `getChromeForTab(wcId)` reverse lookups; last-focused tracking
      (seed at create + programmatic focus; latest-event-wins — the spike
      observed idle focus/blur flapping; membership-validated read with
      first-record fallback). Pure module, Electron objects injected.
- [x] main.js adopts the registry: `createWindow()` builds a record;
      every former singleton read routes per the THREE routing classes
      (+1b window-lifecycle). **Census discipline (review F5/F6): the
      census is DERIVED FRESH at implementation start** — grep main.js for
      `getChromeContents\(\)|mainWindow|tabViews|activeTabWcId|
      getActiveTabContents` and classify EVERY hit before converting any;
      the grep-AC below is supplementary only (zero-param handlers like
      window controls/:1439 choose-download-dir and event-USING handlers
      like the dev seam pass it silently — the checklist is the
      authoritative net). Class-3 sends resolve `getChromeForTab` AT EVENT
      TIME: the wireTabViewEvents fan, zoom-changed, devtools-state-changed,
      page-context-menu, privacy delivery (:1592 timer fires at send time),
      guest-keystroke forwarders, **and the guest-sender media/privacy
      forwarders `tab-media-list` (:2495-2500) + `tab-privacy-fp`
      (:2503-2509) (review F1 — leg 4's adopt lost-state ruling depends on
      these being owner-routed)**. Class-2: `broadcastToChromeAndInternal`
      fans to ALL chromes + internal-session contents once globally.
      Class-1: sender-resolved handlers (window controls, menu/find sender
      checks, tab-create/close/set-active, dialog parenting :1440,
      **the dev-invoke seam's sender check :2887 (review F3)**,
      download-media's active-tab fallback chain :1404) — grep-AC
      (supplementary): no `_e` or `_event` remains on a window-resolving
      handler.
- [x] `grabWindow` interim disposition (review F2): binds to the
      last-focused record's chrome/active-tab through the SAME accessor
      rule as everything else (membership-validated, first-record
      fallback); capture semantics remain F7's. ALL leg-2 re-points use
      that one rule — no mixed "first record here, last-focused there".
- [x] Lifecycle split (DD3), step assignment PINNED (review F8): at
      **`close`** — capture point (wired; capture body lands in leg 3),
      per-tab side-effect suite (forgetTab, find-session close,
      roaming-overlay detach guard), guest destroy; at **`closed`** —
      record removal. Overlay DESTRUCTION moves to quit hooks with the
      find-before-sheet ordering pin traveling;
      `window-all-closed`/`before-quit`/`will-quit` split preserved;
      unguarded `mainWindow` derefs in tab-create/tab-close guarded (now
      record-resolved).
- [x] DD8 accessor interim: automation `getChromeContents` = last-focused
      record's chrome (membership-validated, first-record fallback);
      `isTabViewWcId` widens to all-windows membership at BOTH injection
      sites (:799 MCP engine AND :2877 dev-invoke engine — review F3);
      the jar-tier chrome-exclusion predicate widens to "is any registered
      chrome" (resolve.js:167); `classifyContents` (resolve.js:48)
      recognizes every registered chrome as 'chrome' (spike residual).
      getChromeTarget still returns the accessor's chrome (F7 owns
      multi-window semantics).
- [x] Overlay singletons keep working, nothing hardcodes `mainWindow`
      (review F4 — the two have DIFFERENT shapes): menu-overlay manager =
      re-point its injected closures (`getContentView` :515,
      `sendToChrome` :518) through the registry; find overlay = convert
      its INLINE `mainWindow` derefs (teardown :267, show :339-346, hide
      :353-355) and its two bare chrome sends (`find-overlay-closed`
      :2454, `find-overlay-text` :2481) — it has no closure seam. Full
      DD7 roaming (attachment tracking etc.) lands in leg 4.
- [x] **Single-window invariant**: `npm test` green (existing suites
      untouched in meaning; registry suite added); lint/typecheck green;
      live regression TRIPLE re-run PASS with specs UNMODIFIED (Witnessed
      runs, house apparatus): `tab-context-menu` + `closed-tab-reopen` +
      **`find-overlay-geometry`** (review F7 — covers the find-overlay
      re-point and class-1b maximize routing the pair leaves dark).
- [x] Doc enumeration-invalidation question answered in the leg's flight-
      log entry (which CLAUDE.md/README/docs enumerations this change
      invalidates — expected: CLAUDE.md main-process architecture bullets;
      full doc refresh lands with leg 5's grep-ACs).
- [x] Flight log leg entry; leg → landed. Do NOT commit.

## Files Affected

- `src/main/window-registry.js` (new) + `test/unit/window-registry.test.js`
  (new)
- `src/main/main.js` (the conversion — expect net-neutral or shrinking
  via extraction)
- `src/main/automation/resolve.js`, `engine.js` (deps threading :79),
  `scope.js` (memberDeps chrome compare :120-124) (+ engine wiring in
  main.js) — review F9
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
