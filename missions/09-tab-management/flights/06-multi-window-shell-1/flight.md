# Flight: Multi-Window Shell, Part 1

**Status**: completed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [x] A tab can be moved into a new window ("Move to new window" — menu +
      command), arriving with its address, cookie jar, and navigation
      history intact; the originating window's strip closes ranks. *(First
      cross-window operation; tear-off/drag lands F8 on this shell.
      Behavior-test-backed — new `multi-window-shell` spec.)*
- [x] The app supports multiple windows with correct lifecycle: closing one
      of N windows never quits the app; closing the last does (non-macOS);
      each window has a fully functional strip, chrome, and menus.
- [x] Advances the tab-context-menu criterion's deferred "move to new
      window" item (F5's deferral closes here).

---

## Pre-Flight

### Objective

Convert the single-window shell into a window registry with per-window
chrome/tab state, correct close-one vs quit-on-last lifecycle, and land
"Move to new window" as the first cross-window operation — re-parenting the
live guest view (spike-gated) so the page keeps its live state, with a
close-and-recreate fallback via the F4/F5 snapshot seam if the platform
spike fails the mid-motion visual bar. Overlay (sheet/find) MULTI-instance
conversion, capture semantics, and automation multi-window semantics stay in
Flight 7; F6 ships a roaming-singleton interim so a second window is fully
usable. A singular-window audit of the behavior-spec corpus is a named
deliverable (46 specs swept at recon — the audit report is input to F7's
automation-semantics work).

### Recon (Phase 1b digest — full fact base in the flight log)

Code interrogation established: the per-window singleton census in main.js
(`mainWindow`, `chromeView`, `tabViews`, `activeTabWcId`, find-overlay
cluster, sheet manager — main.js:207-259, 514-543); `broadcastToChromeAndInternal`
(main.js:1759) as the single-chrome fan-out chokepoint (~12 channels);
guests today NEVER detach without destroy (the only guest `removeChildView`
is the destroy path, main.js:2211) — the re-parenting primitive is untested
territory, exactly the class CLAUDE.md's native-surface invariant says to
spike on-platform; `enumerateTabs` is renderer-Map-backed (window-1-only
with N windows, silently); `app.on('activate')` is the only
`getAllWindows()`-aware seam; two unguarded `mainWindow` derefs in
tab-create/tab-close (main.js:2137, 2211); the closed-tab stack has ONE
capture site (tab-close, main.js:2198) and stripIndex flows from the
renderer.

### Open Questions

- [x] Per-window vs global closed-tab stack (F4 debrief pin)? → **ONE
      global stack with `windowId`-tagged entries** (DD4). Deciding factor:
      whole-window close capture needs the entries to OUTLIVE their window,
      and per-window stacks have no home for that without inventing a
      recently-closed-windows surface mid-mission (F9's territory — tagged
      entries are exactly what F9's session layer can group by windowId).
      Documented divergence from strict Chrome per-window reopen parity.
- [x] `stripIndex` semantics under multiple strips (F4 pin)? → stripIndex
      is meaningful ONLY in the origin window's strip: reopen honors it
      when `entry.windowId` == the invoking window's id AND that window
      still exists; otherwise append (the existing negative-sentinel append
      rule reused). (DD4)
- [x] Whole-window close capture (F4 pin: N entries vs a window entry)? →
      **N ordinary entries, captured at the window's `close` event in
      tabViews insertion order with the append stripIndex sentinel**
      (persist-jar allowlist applies per entry; burner/internal
      structurally excluded as today). LIFO pops restore in reverse
      insertion order, appended, into whichever window invokes reopen. A
      "window entry" shape is F9's call; F6 must not invent a second entry
      type the stack module would have to special-case. (DD4)
- [x] Module split — the mandatory agenda item (F5 debrief)? → **Decided,
      two-part**: (a) F6 extracts the window record + registry + lifecycle
      into a new `src/main/window-registry.js` (pure where possible,
      unit-tested) — the conversion forces this extraction anyway; (b) the
      renderer per-menu-cluster split is scheduled as its own
      post-mission maintenance flight (BACKLOG entry with the F5-debrief
      cluster inventory) — bundling a 3,768-line renderer refactor into the
      mission's riskiest feature flight maximizes both risks. The DECISION
      is made; the renderer split is deliberately not F6 work. (DD2)
- [x] Async-opener disposition (F5 debrief: prefer push-cache)? → **(b)
      push-cache**: main pushes stack-size on every stack mutation (a
      `closed-tab-stack-changed` broadcast via the all-chromes fan-out);
      the chrome caches it; `openTabContextMenu` goes synchronous again.
      Deletes the sheet's only async opener, structurally removing the
      cross-type stale-resolve edge (F5 Reviewer issue 6) and the
      duplicate `sourceIndex` staleness sibling. (DD6)
- [x] One chrome renderer per window (F5 debrief: state as a DD, not
      silently)? → YES — each window gets its own chrome WebContentsView
      running renderer.js; per-document state (tabs Map, activeTabId,
      panels, caches) is naturally per-window. (DD2)
- [x] How does a second window come to exist? → Two entry points this
      flight: `tab:move-new-window` (the menu/command op) and an explicit
      New Window command (kebab item + `Ctrl+N`/`Cmd+N` through the
      one-classifier path). A new window from Ctrl+N boots its home tab
      exactly like first launch (the renderer's existing boot-tab path); a
      window created BY move-to-new-window must NOT boot a home tab (it
      receives the moved tab instead — suppression flag in the create
      chain). (DD5)
- [x] Does the moved tab keep live page state? → Spike-gated (DD1). If
      re-parenting passes the visual bar: yes (same webContents, media/
      scroll/form state intact). If not: close-and-recreate fallback via
      `tab-history-snapshot` + `createTab(restoreHistory, ...)` (the F4/F5
      seam, treated as stable API) — history carried, live state lost;
      recorded as a known limitation and a HAT walkthrough item. (DD1/DD5)

### Design Decisions

**DD1 — Re-parenting spike is the flight gate (leg 0, before any leg-1
code).** On this platform (WSLg/Wayland — the operator's real environment),
verify with a throwaway harness: `winA.contentView.removeChildView(guest)`
→ `winB.contentView.addChildView(guest)` with a live page (video playing,
scrolled position) — webContents survives, renders in B, input works, no
teardown; **mid-motion visual acceptance bar** per the mission: capture the
transition and judge rendered pixels, not DOM state ("DOM correct ≠ render
correct" — CLAUDE.md native-surface invariant). The SAME spike must also
answer (design-review additions, pass 1):
(a) admin-tier `evaluate` can address a second window's chrome by raw wcId
    (the F6/F7 apparatus premise — observability audit, both axes: the
    spec must both ACT on and OBSERVE window 2);
(b) `setBounds` behaves across windows with differing content bounds;
(c) **overlay-class roaming** (transparent chrome-class view detach/attach
    across windows while hidden — DD7's primitive, distinct from the
    guest's mid-motion bar);
(d) **guests alive + `navigationHistory` readable at window-`close` vs
    `closed` time** (DD4's capture hook depends on the answer; `close`
    fires pre-teardown and is the presumed-safe hook — verify);
(e) **`BaseWindow.getFocusedWindow()` and programmatic `win.focus()`
    behavior under WSLg with injected input** (document.hasFocus() is
    known-unsatisfiable here — F3 debrief; DD8's interim resolution rule
    depends on whether the main-process focus APIs are equally poisoned).
Divert rule in Adaptation Criteria. Spike findings land in the flight log
BEFORE leg 2 is designed.

**DD2 — Window registry: `src/main/window-registry.js` + per-window record
+ THREE routing classes (design-review H1).**
A `windows` Map keyed by `BaseWindow.id` (Electron-unique), each record
`{win, chromeView, tabViews, activeTabWcId, findOverlay?, sheet?}` — the
recon's per-window census moves INTO the record; app-globals (closedTabStack,
stores, MCP, downloads, privacy data) stay module-scope. The conversion has
three distinct routing classes — each send/handler site is classified in
the leg (the ~30-site census is in the flight log):
1. **Inbound sender-resolved**: chrome-sender IPC resolves its window via
   `event.sender` → `getWindowForChrome`; guest-sender IPC resolves via
   `getWindowForGuest(event.sender.id)` (reverse lookup over records'
   tabViews); sheet/find-overlay senders resolve to their CURRENT
   attachment window (DD7). No handler keeps an ignored-event parameter if
   it must resolve a window (leg grep-AC: no `_e` OR `_event` remains on a
   window-resolving handler — main.js's dominant convention is `_e`, and
   genuinely window-resolving sites use it, e.g. `internal-open-tab-in-jar`,
   the downloads retry).
   **Class 1b — window-lifecycle events**: a window's own events
   (`resize`/`maximize`/`unmaximize` → `trigger-send-bounds`,
   `window-maximized-change`) route to THAT window's own chrome via the
   per-window create closure (pass-2 L-a: neither per-tab, broadcast, nor
   sender-resolved).
2. **Broadcast fan-out**: `broadcastToChromeAndInternal` → ALL registered
   chromes + internal-session contents ONCE GLOBALLY (never per-window —
   internal pages must not receive N copies).
3. **Per-tab owner-routed pushes** (the class the draft missed): every
   main→chrome send tied to a specific tab routes to the tab's OWNING
   window's chrome, resolved AT EVENT TIME via `getChromeForTab(wcId)` —
   the `wireTabViewEvents` fan (`tab-did-navigate`, `tab-nav-state`,
   `tab-title`, `tab-favicon`, `tab-loading`, `tab-did-finish-load`,
   `tab-dom-ready`), `zoom-changed`, `devtools-state-changed`,
   `page-context-menu`, `privacy-net`/`privacy-permission` delivery, and
   the guest-keystroke forwarders (`chrome-shortcut-action`, guest
   `open-tab`, guest Ctrl+F/Ctrl+J). Never fan these out; never leave them
   on a focused-window accessor. Event-time resolution is what makes DD5's
   adopt re-bind automatic.
The two unguarded `mainWindow` derefs (tab-create/tab-close) get guarded in
the same move. One chrome renderer per window (each window's chrome runs
renderer.js; per-document state is per-window by construction). The
registry module is pure where practicable (record create/lookup/remove/
iterate, `getChromeForTab`/`getWindowForGuest` reverse lookups,
last-focused tracking given injected focus events), unit-tested; Electron
wiring stays in main.js.

**DD3 — Lifecycle: close-one vs quit-on-last.** Per-window teardown runs at
the window's **`close`** event (pre-teardown — DD4's capture point) +
`closed` (record removal): capture per DD4, then replicate tab-close's
per-tab side-effect suite for every dying guest (design-review M5) —
`historyRecorder.forgetTab`, find-session close if the find session targets
a dying tab, and detach/state-reset of whichever roaming overlay (DD7) is
currently attached to the dying window — then destroy guests, null the
chrome, remove the registry entry. App-level teardown (`mcpServer.stop`,
stores, overlay DESTRUCTION) stays at quit-time hooks
(`window-all-closed`/`before-quit`/`will-quit` — the existing split
preserved). Overlay destruction MOVES location (window-`closed` → quit
hooks) and its ordering pin travels with it: find-overlay teardown BEFORE
`closeMenuOverlay('teardown')` + manager teardown (the F8 DD5 pin —
pass-2 L-d). Non-darwin: `window-all-closed` → quit (unchanged). darwin:
dock-resident (unchanged); `app.on('activate')` creates a fresh window when
none exist (already N-aware). Kebab Exit stays `app.quit()` (quits ALL
windows). Window-control IPCs (`window-minimize/close/toggle-maximize/
is-maximized`) resolve the SENDER's window. `win.destroy()` (no `close`
event) skips capture — accepted, documented edge.

**DD4 — Closed-tab stack: global, windowId-tagged, whole-window capture at
the `close` event (design-review H2 resolution).**
Entry shape gains `windowId` (the stack module is entry-shape-agnostic —
untouched). The single tab-close capture site tags
`event.sender`-resolved windowId. Reopen (`tab-reopen`) honors
`stripIndex` only when the entry's windowId matches the INVOKING window's
id; otherwise the existing negative-sentinel append. Whole-window close:
capture runs at the window's **`close`** event (pre-teardown; guests alive
and `navigationHistory` readable — spike item (d) verifies; `closed` is
presumed too late), reusing the tab-close capture body per tab — same
positive persist-jar allowlist, same trusted/internal exclusions. **Order
and stripIndex for whole-window entries**: captured in `tabViews`
insertion order with `stripIndex` = the append sentinel (-1). Rationale:
main does not know strip order (it is renderer DOM order, and no renderer
round-trip is available during close), and per-entry stripIndex is dead
weight anyway — a whole-window entry's windowId can never match the
invoking window at pop time (that window is gone), so DD4's own rule
already forces append for every such entry. Documented divergence: LIFO
pops after a window close restore in reverse insertion order, appended.
`closed-tab-stack-size` remains global (the menu's omission rule is "is
there anything to reopen", not "in this window"). Chrome-parity divergence
(global pop vs per-window) documented in README/CLAUDE.md.

**DD5 — Move to new window: spike-gated primitive + explicit adopt
protocol.** Menu item `tab:move-new-window` in `tabContextModel` (omitted
at `isLastTab` — moving a sole tab is a no-op window swap) + a New Window
command (kebab + Ctrl+N via keydown-action → dispatchChromeAction — BOTH
classifier copies in lockstep per the hand-mirror pin, and the
guest-forward allowlist gains the action). The move op is
renderer-initiated (source window's dispatch), main-executed:
1. Source chrome invokes `tab-move-to-new-window(wcId)`.
2. Main creates a window via the registry with a `noBootTab` flag (the
   boot-tab suppression is part of the window-create chain, not a renderer
   guess), re-parents the guest view (DD1 primitive), moves the `tabViews`
   record between window records, and updates `activeTabWcId` both sides.
3. Main sends the SOURCE chrome `tab-moved-away(wcId)` (strip removal
   WITHOUT destroy — a new renderer branch beside the close path) and the
   TARGET chrome `adopt-tab({wcId, url, title, jarId, ...})` (strip
   insertion WITHOUT createTab — the adopt branch is unavoidable for true
   re-parenting; F4's "no adopt path" ruling was about REOPEN, where
   createTab already existed — here the webContents already lives, so
   construction is not an option).
   The adopt message carries everything the strip needs; the target
   renderer must not need a follow-up round-trip. **Payload decisions
   (design-review M4)**: the FULL container object rides the payload
   (id/name/color/partition/burner — a burner's synthesized container is
   not resolvable from the target chrome's jar list by id, so burner tabs
   ARE movable); `tab:move-new-window` is OMITTED for internal tabs
   (app-UI pages; model rule beside isLastTab); main pushes one
   `tab-nav-state` to the target chrome immediately after adopt (the
   target has no nav-button state until the next navigation otherwise).
   Deliberately re-derived/lost renderer-side on move, documented: media
   list (repopulates on next `tab-media-list` push), find state
   (`findText`/`findOpen` reset — find session closes with the source
   window binding), privacy aggregate display (repopulates on next
   `privacy-net`).
4. The adopt RE-BIND premise (design-review H1): the moved tab's per-tab
   main→chrome event fan re-binds to the new window automatically BECAUSE
   DD2's class-3 sends resolve the owning window at event time — the leg
   verifies this per channel rather than assuming it, INCLUDING tolerance
   of pushes arriving pre-adopt (between the record move and adopt-tab
   delivery, a class-3 push can reach the target chrome for a wcId it
   hasn't adopted yet — renderer handlers must null-guard unknown wcIds;
   pass-2 L-e).
5. Fallback (spike-fail): the same dispatch body routes through
   `tab-history-snapshot` + cross-window `createTab` + `closeTab` —
   renderer-orchestrated, no adopt branch, live state lost (documented).
Focus follows the moved tab (the new window is focused, the tab active —
Chrome parity). Boot-tab suppression transport (design-review L4): the
chrome document learns its boot config via a `window-boot-config` invoke
joining the renderer's existing boot-gating `Promise.all` (settings+jars
snapshot idiom) — not argv magic.

**DD6 — Stack-size push-cache (opener sync-ification).** Main broadcasts
`closed-tab-stack-changed {size}` on every push/pop/clear via the DD2
fan-out (chromes-only — no internal-page consumer; design-review L1); the
chrome caches the size; `openTabContextMenu` and the model build go
synchronous (the awaited invoke is deleted; the `closed-tab-stack-size`
invoke handler stays as the boot seed — the cache initializes from it at
chrome load). **Seed/push race rule (L1): a received push always wins; the
seed applies only if no push has arrived** (monotonic by arrival, not by
value). This deletes the async-opener shape (F5 debrief recommendation
(b)), structurally removing the cross-type stale-resolve edge and the
duplicate `sourceIndex` staleness. The F5 flight log's known-edge note gets
its fold-in here.

**DD7 — Interim overlay ownership: roaming singletons with ATTACHMENT
TRACKING (F7 boundary; design-review M1/M2 amendments).** The ONE sheet and
ONE find overlay remain single instances in F6, attaching to the REQUESTING
window's contentView at show time. The manager API changes named up front:
- **Attachment tracking**: the manager records the contentView/window it
  attached to at show time and removes from THAT at hide — never a
  hide-time `getContentView()` re-resolve (removing from a non-parent is
  documented-undefined behavior; the current manager re-resolves at hide).
- **Per-window bounds**: `lastGuestBounds` is a single slot polluted by any
  window's `tab-set-bounds` — the show path fetches the REQUESTING window's
  current guest bounds instead of trusting the slot (find overlay same).
- **Blur conditioning**: each window's `blur` → close-menu fires ONLY when
  the blurred window is the sheet's current attachment window (else
  opening a menu in window B is killed by A's in-flight blur).
- **Accelerator scope**: the sheet's `before-input-event` forwarder acts on
  the ATTACHMENT window's active tab and chrome (resolved from the tracked
  attachment), not the global singletons.
- **Fallback (spike item (c) fails)**: recreate-per-window-switch — the
  manager's existing destroyed-recreate machinery (`ensureView`) tears the
  view down and lazily rebuilds in the new window; hidden recreation has
  no mid-motion bar, so this fallback is always available.
This makes window 2's menus/find fully functional without F7's per-window
instance conversion; F7 replaces roaming with true per-window instances
when it does capture semantics. Interim constraint (documented): the sheet
serves one window at a time — opening a menu in window B while A's menu is
open closes A's first (the existing superseded semantics).

**DD8 — Automation surface: F6 interim contract + the singular-window
audit (design-review M3 resolution).** F7 owns multi-window automation
semantics. F6's interim, stated: the engine's `getChromeContents` resolves
to **the main-tracked LAST-FOCUSED window's chrome, falling back to the
registry's first record** — deterministic and WSLg-safe. The registry
tracks last-focused from window `focus` events, SEEDED at window create
and at programmatic `win.focus()` (so move-to-new-window deterministically
retargets the accessor even if the compositor never delivers focus —
`BaseWindow.getFocusedWindow()` may be null/stale for entire automation
runs under WSLg; spike item (e) documents the actual behavior). The
accessor validates registry membership at read: a last-focused id whose
record is gone (window closed) is invalid and the first-record fallback
fires (pass-2 L-c).
`enumerateTabs`/`openTab`/strip ops therefore act on the last-focused
window; raw-wcId ops (`navigate`, `evaluate`, `readDom`, ...) already work
cross-window at their existing tiers (`isTabViewWcId` gains all-windows
membership; the jar-tier chrome-exclusion predicate widens from
identity-with-THE-chrome to "is any registered chrome" in the same move —
design-review L5, F6 owns it since F6 widens the membership). With ONE
window open, every existing behavior is byte-identical — the 46-spec
corpus keeps passing unmodified; that invariant is a leg AC. The
**singular-window audit** (mission work item) lands as a committed artifact
(`docs/behavior-specs-single-window-audit.md`) from the recon's §8 sweep:
per spec, its single-window assumption class (probe-walk /
getChromeTarget-ambiguity / captureWindow / count-precondition / none) —
F7 consumes it when it redefines the surface; specs are NOT edited in F6.

**DD9 — Verification: new `multi-window-shell` behavior spec.** Witnessed,
admin apparatus, scratch profile, fixture server; key observables: New
Window yields a second window whose chrome is addressable (admin raw-wcId
evaluate — the DD1(a) premise), boots exactly one home tab, and has working
menus (roaming sheet); move-to-new-window transfers the tab (same wcId if
re-parented — THE discriminator between re-parent and recreate; the spec
pins whichever path the spike selected), source strip closes ranks, target
window has no extra boot tab, jar + history intact (goBack probe), focus
follows; close-one-of-N keeps the app alive (surviving window still
drives); whole-window close captures its persist tabs (reopen in the
survivor restores them LIFO, append position); quit-on-last unchanged.
**Spec-authoring constraint (design-review M3): every window-2 action and
observation goes through admin raw-wcId ops exclusively** — per-wcId
`captureScreenshot`, never `captureWindow` (its desktopCapturer
best-size-match heuristic can capture the WRONG of two similar windows);
no reliance on OS focus state (WSLg). Single-window regression:
`tab-context-menu` + `closed-tab-reopen` re-run green post-conversion (the
cheapest high-coverage regression pair: menus, stack, reopen chain). Doc
grep-ACs per the F4 rule + the F5 count-drift lesson: the leg adding
windows carries "which existing doc enumerations does this change
invalidate?" as an explicit leg-design question with enumerated answers
(CLAUDE.md architecture bullets, README shortcuts table,
docs/mcp-automation.md single-window statements).

### Prerequisites

- [x] Flights 1–5 landed (stack: #84←#85←#86←#87←#88).
- [x] Recon fact base (flight log) — singleton census, send-site
      enumeration, spec sweep.
- [x] `tab-history-snapshot` + `createTab(restoreHistory, insertAt)` seams
      live and stable (F4/F5) — the fallback path needs no new invokes.
- [x] DD1 spike PASSED on-platform (leg 0 — gate for DD5's primary path;
      the fallback keeps the flight shippable either way).
- [x] Apparatus premise (DD1(a)): admin evaluate reaches a second window's
      chrome by raw wcId — verified in the spike (act + observe axes).

### Pre-Flight Checklist

- [x] All open questions resolved (six pins from F4/F5 debriefs decided
      above)
- [x] Design decisions documented (DD1–DD9)
- [x] Prerequisites verified except the spike gate (leg 0 by design)
- [x] Validation approach defined (DD9)
- [x] Legs defined (below; planned one at a time per house rule)

---

## In-Flight

### Technical Approach

Spike first (DD1 — throwaway harness, findings to the flight log). Then the
registry conversion (DD2/DD3/DD4/DD6 — main.js restructure around
`window-registry.js`, the fan-out, lifecycle, stack tagging, push-cache;
this is the M05-migration-scale leg). Then the cross-window feature (DD5 +
DD7 — new-window command, move-to-new-window with adopt protocol, roaming
overlays). Then verification (DD8/DD9 — audit artifact, new spec, single-
window regression pair, docs). renderer.js growth expected ~100–150 lines
(adopt branch, moved-away branch, cache, new-window dispatch) — estimate
DOUBLED from the F5 lesson; main.js net shrinks or holds via the registry
extraction.

### Checkpoints

- [x] Spike verdict recorded (re-parent vs fallback) + apparatus premise
      confirmed.
- [x] Registry conversion lands with ALL suites green and the single-window
      regression pair (`tab-context-menu`, `closed-tab-reopen`) passing
      unmodified — the "one window open ⇒ byte-identical behavior"
      invariant.
- [x] Move-to-new-window works live end-to-end (either path); focus
      follows; strips correct both sides.
- [x] `multi-window-shell` spec passes; audit artifact committed; docs
      current (incl. the enumeration-invalidation answers).

### Adaptation Criteria

**Divert if**: the spike fails the mid-motion visual bar on-platform (or
webContents does not survive re-parent) → DD5 falls back to
close-and-recreate (snapshot seam); the spec's same-wcId discriminator
flips to a new-wcId + history-fidelity assertion; live-state loss becomes a
documented limitation + HAT item. **Escalate if**: the registry conversion
breaks the single-window regression pair in ways that require respec'ing
existing specs — that's F7 scope bleeding in; stop and re-plan rather than
editing specs mid-flight.

**Acceptable variations**: New Window entry-point set (kebab + Ctrl+N
minimum); whether the moved tab's window inherits source window bounds
offset or centers; roaming-overlay focus edge cases (documented, F7
resolves).

### Legs

> Tentative; planned one at a time.

- [x] `reparenting-spike` — DD1 gate: throwaway two-window harness — guest
      mid-motion bar, overlay-class roaming (c), close-vs-closed guest
      liveness (d), focus APIs under WSLg (e), apparatus premise (a/b).
      Findings + verdict to flight log. No product code.
- [x] `window-registry-and-routing` — DD2/DD3 + DD8's accessor: registry
      module + unit net, the three routing classes across the ~30-site
      census (owner-routed per-tab fan, all-chromes broadcast,
      sender-resolved handlers incl. guest reverse lookup), lifecycle
      split with the M5 per-tab side-effect suite, guarded derefs,
      last-focused accessor + isTabViewWcId/jar-guard widening.
      Single-window invariant AC (regression pair green unmodified).
- [x] `stack-and-cache` — DD4/DD6: windowId tagging, whole-window capture
      at `close` (insertion order + append sentinel), pop rules,
      push-cache + sync opener (F5 edge fold-in), seed/push race rule.
- [x] `move-to-new-window` — DD5/DD7: new-window command (both classifier
      copies + guest-forward allowlist), tab:move-new-window model row
      (omit isLastTab + internal) + dispatch, adopt/moved-away renderer
      branches (or fallback body) + per-channel re-bind verification,
      window-boot-config invoke, roaming overlays with attachment
      tracking, focus rules.
- [x] `verify-integration` — DD8/DD9: audit artifact, `multi-window-shell`
      spec authored + run (window-2 via raw-wcId ops only), single-window
      regression pair re-run, a11y sweep, suites, docs + enumeration-
      invalidation ACs.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (PR opened, stacks on flight/5 — operator merges)
- [x] Tests passing
- [x] Documentation updated (CLAUDE.md window-registry architecture section;
      README New Window + Move to new window; docs/mcp-automation.md
      interim focused-window note; the audit artifact)

### Verification

- New `tests/behavior/multi-window-shell.md` passes.
- `tab-context-menu` + `closed-tab-reopen` re-run green unmodified
  (single-window invariant).
- `npm run a11y` green; suites green.
- `docs/behavior-specs-single-window-audit.md` committed (F7 input).
