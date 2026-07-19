// @ts-check
'use strict';

/**
 * Register the complete tab lifecycle and cross-window move surface.
 * Electron constructors and every ownership authority are injected.
 * @param {any} deps
 */
function registerTabIpc(deps) {
  const {
    ipcMain,
    WebContentsView,
    internalPreloadPath,
    webPreloadPath,
    INTERNAL_PARTITION,
    registry,
    wireGuestContents,
    wireTabViewEvents,
    captureClosedTabEntry,
    jars,
    APPEND_SENTINEL,
    closedTabStack,
    broadcastClosedTabStackChanged,
    getHistoryRecorder,
    isSafeTabUrl,
    reopenStripIndex,
    webContents,
    isInternalContents,
    buildMoveTargets,
    createWindow,
    validateMoveTabPayload,
    buildAdoptPayload,
    broadcastMoveTargetsChanged,
    getTabContents,
    schedule: setTimeout,
    cancelScheduled: clearTimeout,
    logger
  } = deps;

  function queueChromeSend(record, buildMessage) {
    if (record.bootConfigServed) {
      const chrome = record.chromeView.webContents;
      if (chrome && !chrome.isDestroyed()) {
        const [channel, payload] = buildMessage();
        chrome.send(channel, payload);
      }
    } else {
      record.pendingChromeSends.push(buildMessage);
    }
  }

// ---------------------------------------------------------------------------
// Tab view IPC handlers (Flight 3, Leg 1 — web tab lifecycle via WebContentsView)
// ---------------------------------------------------------------------------

ipcMain.handle('tab-create', (event, { url, partition, trusted, restoreHistory }) => {
  // -----------------------------------------------------------------------
  // Pick webPreferences by trust level (Leg 3).
  //
  // INTERNAL (trusted=true): byte-exact webPreferences set at construction time on the
  // trusted `tab-create` path. The partition MUST come from the INTERNAL_PARTITION constant —
  // any literal drift silently resolves a different session → marker absent → gates,
  // protocol.handle, bridge, and automation exclusion all fail open. (DD0 / security)
  //
  // WEB (trusted=false): web prefs — contextIsolation:false so the farbling preload runs
  // in the page main world (required). NO spellcheck key — the session-layer applier
  // (applySpellcheck) owns the live web toggle; a constructed view's spellcheck pref is
  // immutable after attach, so inheriting the session default is correct. (DD3)
  // -----------------------------------------------------------------------
  let preloadPath;
  let webPreferencesObj;
  if (trusted) {
    preloadPath = internalPreloadPath;
    webPreferencesObj = {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: INTERNAL_PARTITION,
      spellcheck: false,
    };
  } else {
    preloadPath = webPreloadPath;
    webPreferencesObj = {
      preload: preloadPath,
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      partition: partition,
      // NO spellcheck key — the session-layer applier (applySpellcheck) owns the web toggle
    };
  }
  // Class 1 (F6 DD2): the tab is created in the SENDER's window. The former
  // unguarded mainWindow deref is now a guarded early return (a tab-create racing
  // window teardown returns null instead of crashing main).
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec) return null;
  const view = new WebContentsView({ webPreferences: webPreferencesObj });
  rec.win.contentView.addChildView(view);

  // Seed initial bounds
  {
    const { width, height } = rec.win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  }
  view.setVisible(false);

  const wcId = view.webContents.id;
  rec.tabViews.set(wcId, { view, partition: trusted ? INTERNAL_PARTITION : partition, trusted, active: false });

  // Explicit construction-time wiring: web-contents-created fires synchronously
  // during new WebContentsView(), so the global handler cannot identify the view yet.
  // Wire explicitly here so all guest event listeners are installed before loadURL.
  wireGuestContents(view.webContents);

  // Tab-strip event forwarding
  wireTabViewEvents(view, wcId, trusted ? INTERNAL_PARTITION : partition);

  // M09 F4 Leg 2 (DD2 step 4) — reopen-chain restore branch (design-review race
  // fix). When the payload carries `restoreHistory`, SKIP `loadURL(url)`
  // entirely and call `navigationHistory.restore()` instead — `restore()`
  // triggers its own navigation, so calling `loadURL` too would race two
  // competing navigations against the same fresh WebContentsView. `index` is
  // passed EXPLICITLY: omitting it loads the newest entry, silently wrong for
  // a tab that had navigated back before it was closed. `restore()` already
  // attaches a noop rejection handler (Electron docs) — the `.catch` here is
  // purely diagnostic logging, mirroring the `loadURL` branch below.
  if (restoreHistory && Array.isArray(restoreHistory.entries)) {
    view.webContents.navigationHistory.restore({
      entries: restoreHistory.entries,
      index: restoreHistory.index,
    }).catch((err) => {
      logger.warn('[tab-create] navigationHistory.restore rejected:', err && (err.code || err.message || err));
    });
  } else {
    view.webContents.loadURL(url).catch((err) => {
      logger.warn('[tab-create] loadURL rejected:', err && (err.code || err.message || err));
    });
  }
  return wcId;
});

ipcMain.on('tab-close', (event, wcId, stripIndex) => {
  // Class 1 (F6 DD2): resolve the OWNING window's record (guest reverse lookup) —
  // also the guard that replaces the former unguarded mainWindow deref below.
  const owner = registry.getWindowForGuest(wcId);
  const entry = owner ? owner.tabViews.get(wcId) : null;
  if (!owner || !entry) return;
  // Captured BEFORE the null-out below — one line lower and this is always false.
  const wasActive = owner.activeTabWcId === wcId;
  // M09 F4 Leg 1 (DD2) — closed-tab-stack capture. Sits strictly BEFORE destroy()/
  // tabViews.delete below (the webContents and its navigationHistory must still be
  // alive to read). The allowlist/exclusion body lives in captureClosedTabEntry
  // (F6 leg 3 — shared with the whole-window `close` capture site): positive
  // persist-jar allowlist, burner/internal structurally excluded, `!trusted`
  // belt-and-suspenders. The entry is tagged with the OWNING window's id (DD4 —
  // `owner` is the guest's reverse-resolved record above), which the pop rule
  // compares against the reopen invoker. Whole block try/catch — capture must
  // never break close.
  try {
    const captured = captureClosedTabEntry({
      tabEntry: entry,
      jarsList: jars.list(),
      stripIndex: Number.isInteger(stripIndex) ? stripIndex : APPEND_SENTINEL,
      windowId: owner.win.id,
    });
    if (captured) {
      closedTabStack.push(captured);
      broadcastClosedTabStackChanged();
    }
  } catch (err) {
    logger.error('[closed-tab-stack] capture failed:', err);
  }
  if (!owner.win.isDestroyed()) {
    owner.win.contentView.removeChildView(entry.view);
  }
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.destroy();
  }
  owner.tabViews.delete(wcId);
  getHistoryRecorder()?.forgetTab(wcId);
  if (owner.activeTabWcId === wcId) owner.activeTabWcId = null;
  // Find-overlay session teardown (AC6d): the session target is being destroyed —
  // close the session with NO refocus (nothing sensible to focus; the stopFind inside
  // close tolerates the mid-destruction guest via getTabContents' guards, and the
  // entry is already deleted above so it resolves null). Placed with the Leg-1
  // overlay lines, AFTER tabViews.delete.
  if (owner.findOverlay?.isSessionActive(wcId)) owner.findOverlay.closeSession({ refocusGuest: false });
  // Belt-and-suspenders (DD1, Leg 1): closing the active tab, or the last web tab
  // (all-internal remaining), removes the overlay from the stack even sessionless.
  // Menu-overlay close family (F8 DD4): closing the ACTIVE tab while a menu is open
  // closes the menu ('tab-close' — restore explicitly skipped in the DD5 hook, not
  // left to the activeTabWcId null-out accident). Deliberately NO "no web tabs left"
  // mirror — the sheet serves internal tabs as well (DD7); active-tab lifecycle
  // covers it.
  // F7 DD5: THIS owner window's OWN overlays — closing a tab in window B is
  // structurally unable to reach window A's find bar or menu, so the pre-F7
  // attachment conditioning is deleted (both calls are idempotent when inactive).
  if (wasActive) {
    owner.findOverlay?.hide();
    owner.sheet?.closeMenuOverlay('tab-close');
  }
  const anyWebTabLeft = [...owner.tabViews.values()].some((e) => e.trusted === false);
  if (!anyWebTabLeft) owner.findOverlay?.hide();
});

// M09 F4 Leg 2 (DD2 step 2) — reopen-chain invoke #1. Pops the closed-tab stack
// and returns the entry the renderer needs to reconstruct the tab (renderer-
// orchestrated: this handler never constructs a view itself — see DD2's
// design-review correction). Returns `null` on an empty stack (renderer no-ops
// silently, no error surface).
ipcMain.handle('tab-reopen', (event) => {
  const entry = closedTabStack.pop();
  if (!entry) return null;
  // DD6: the pop is a stack MUTATION — the size push fires even when the safety
  // re-check below drops the entry (the stack shrank either way).
  broadcastClosedTabStackChanged();
  // Defense-in-depth re-validation (two-point-boundary parity — DD2 ruling): the
  // URL was already safety-checked at capture-adjacent points, but main re-checks
  // before handing it back to the renderer, same discipline as internal-open-tab-
  // in-jar above. A failed re-check silently drops the reopen (never surfaces a
  // now-unsafe URL) rather than erroring — parity with the empty-stack no-op.
  if (!isSafeTabUrl(entry.url)) return null;
  // Resolve the entry's original jar by id (NOT by partition — the entry stores
  // jarId, resolved at capture time against the SAME jars.list() this re-resolves
  // against). Absent => the jar was deleted between close and reopen: omit
  // `partition` and flag `jarFallback` so the renderer's existing fallback chain
  // (inheritFromPartition -> resolveNewTabContainer -> makeBurner) picks the
  // resolved default, and announces the fallback explicitly.
  const jar = jars.list().find((j) => j.id === entry.jarId);
  // DD4 pop rule (F6 leg 3): the entry's stripIndex is honored only when it was
  // captured in the INVOKING window (sender-resolved) — a reopen invoked from any
  // other window appends instead of landing at a position that belonged to a
  // different strip. Whole-window entries always append by construction (their
  // origin window is gone, so the ids can never match).
  const invoker = registry.getWindowForChrome(event.sender);
  return {
    url: entry.url,
    title: entry.title,
    ...(jar ? { partition: jar.partition } : {}),
    stripIndex: reopenStripIndex(entry, invoker ? invoker.win.id : null),
    navEntries: entry.navEntries,
    navIndex: entry.navIndex,
    jarFallback: !jar,
  };
});

// M09 F5 Leg 1 (DD3) — two tiny chrome-trust-domain invokes for the tab context
// menu's duplicate + reopen-closed items. Bare ipcMain.handle (same trust domain
// as tab-reopen/get-zoom above) — no new privileged surface, both return data the
// chrome already receives through other flows.

// Snapshot a live web tab's navigation history for Duplicate (DD1's resolved open
// question: address + jar + nav history). Acts on the PASSED webContentsId (TOCTOU
// guard, same discipline as toggle-devtools/page-context-correct) — never
// activeTab(). Web tabs only: a dead/missing/internal target returns null (the
// renderer's duplicate dispatch then no-ops rather than duplicating nothing).
ipcMain.handle('tab-history-snapshot', (_e, { webContentsId }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return null;
  if (isInternalContents(wc)) return null;
  return {
    entries: wc.navigationHistory.getAllEntries(),
    index: wc.navigationHistory.getActiveIndex(),
  };
});

// Read-only closed-tab-stack size — since F6 leg 3 (DD6) this is the push-cache's
// BOOT SEED only: the renderer invokes it once at chrome load, and every later
// update arrives via the closed-tab-stack-changed push (which always wins the
// seed/push race renderer-side). Trivial wrapper over the existing
// closedTabStack.size() the tab-reopen handler already shares.
ipcMain.handle('closed-tab-stack-size', () => closedTabStack.size());

// The move-target cache's BOOT SEED (F8 DD8) — the closed-tab-stack-size mirror.
// A chrome that boots into an already-multi-window app sees no push until the
// next window/title change, so without this seed its menu would offer no move
// targets at all. Sender-resolved: the list excludes the ASKING window, and an
// unregistered sender (a pre-registration or torn-down chrome) gets [] rather
// than a list it has no business seeing.
ipcMain.handle('move-targets', (event) => {
  const source = registry.getWindowForChrome(event.sender);
  return source ? buildMoveTargets(registry.records(), source) : [];
});

// Move to new window (M09 F6 Leg 4 — DD5 steps 1–4, renderer-initiated,
// main-executed; spike verdict GO → LIVE re-parent, same webContents).
// (H2) the payload is the SOURCE renderer's strip snapshot ({wcId, url, title,
// favicon, container}) — chrome→chrome trust domain; main shape-validates and
// relays into `adopt-tab`, re-deriving url/title off the live wc at SEND time
// (a burner's synthesized container and the favicon exist ONLY renderer-side).

/**
 * A NEW window sized to `source`'s content box, for the two move paths that make
 * their own target (F8 leg 4: extracted from the core when the core gained a
 * third caller that does NOT create one). Identical chrome layout is what makes
 * the re-applied guest seed exact — spike answer (b).
 * @param {import('./window-registry').WindowRecord} source
 * @returns {import('./window-registry').WindowRecord}
 */
function newWindowForMove(source) {
  const srcContent = source.win.getContentBounds();
  return createWindow({
    noBootTab: true,
    contentSize: { width: srcContent.width, height: srcContent.height },
  });
}

/**
 * The tab-move core (F8 leg 3; generalized over its target at leg 4): re-parent
 * `p.wcId` out of `source` and into the window `resolveTarget` hands back.
 * Factored out of the handler below so the menu path, drag tear-off, and the
 * cross-window keyboard move share ONE move, not three transcriptions of it.
 * SYNCHRONOUS BY CONTRACT — see the invariant at the delete/set pair; do not
 * make it `async`.
 *
 * WHY THE TARGET ARRIVES AS A THUNK rather than a record. Two of the three
 * callers CREATE their target, and creating one before the refusal guards below
 * have run would leave an orphaned empty window behind every refused move.
 * `resolveTarget` is therefore invoked only once the move is committed to. The
 * cross-window caller passes `() => target` for a record it has ALREADY resolved
 * and validated — a pure lookup has no side effect to defer, and doing it in the
 * handler is what keeps a refused cross-window move from closing the source's
 * find session on its way out.
 *
 * DISCRIMINATED RESULT, never a bare null (DD5): the menu ITEM can be omitted at
 * build time (tab-context-model.js omits at !isLastTab && !isInternal); a DRAG
 * cannot be — the user performs it and is owed an outcome. The menu handler
 * narrows this back to F6's bare `null`.
 *
 * @param {import('./window-registry').WindowRecord} source
 * @param {import('./move-tab-payload').MoveTabPayload} p
 * @param {() => import('./window-registry').WindowRecord | null} resolveTarget
 *   The destination, resolved LAZILY — called only after every refusal guard has
 *   passed, and never before.
 * @param {boolean} [allowSoleTab] M09 F10 L3. Defaults false: a sole-tab move
 *   is refused (`sole-tab`), the F8 behavior every caller inherits. The two
 *   EXISTING-window consolidate paths pass true — `tab-move-to-window` and
 *   `tab-adopt-by-drop` (F11 L3, the same semantics by drag) — the source is
 *   then left at zero tabs and CLOSED below. The two `newWindowForMove`
 *   callers (`tab-move-to-new-window`, `tab-tear-off`) keep the default: a
 *   sole-tab move to a NEW window is a no-op window swap.
 * @returns {{ ok: true, windowId: number } | { ok: false, reason: 'no-tab' | 'internal' | 'sole-tab' | 'no-target' }}
 */
function moveTabIntoWindow(source, p, resolveTarget, allowSoleTab = false) {
  const entry = source.tabViews.get(p.wcId);
  // The tab must belong to the SENDER's window and be a live WEB tab (internal
  // tabs are omitted from the model row — review M4 — and refused here as
  // defense-in-depth). A sole-tab move to a NEW window is a no-op window swap:
  // the model omits move-new-window at isLastTab; main refuses it too by default
  // (never leave the source at zero tabs). M09 F10 L3: the EXISTING-window
  // consolidate path passes allowSoleTab, which lets the source empty and closes
  // it below. F6 collapsed these three into ONE `return null`; F8 splits them
  // because a drag must announce WHICH refusal it hit.
  if (!entry || entry.view.webContents.isDestroyed()) return { ok: false, reason: 'no-tab' };
  if (entry.trusted) return { ok: false, reason: 'internal' };
  if (!allowSoleTab && source.tabViews.size <= 1) return { ok: false, reason: 'sole-tab' };
  const wc = entry.view.webContents;

  // (M2) the live find session targets the moved tab: close it FIRST (the
  // tab-close precedent — refocusGuest:false; the session is bound to the
  // source window and does not survive the move; findText/findOpen reset is
  // the documented renderer-side lost state).
  if (source.findOverlay?.isSessionActive(p.wcId)) source.findOverlay.closeSession({ refocusGuest: false });

  // (H3) geometry: capture the guest's current window-local content-DIP bounds
  // BEFORE detach. A window-LOCAL view rect, never a window origin — the DD16
  // ban is on `win.getBounds()`, the screen-space fiction, not on this (leg 3's
  // narrowing, upheld by the FD).
  // ACCEPTED interim visual (documented): for a move-CREATED target the live
  // guest renders over the target's still-booting chrome until adopt completes —
  // a static seed, never an animation (the native-surface invariant: guest
  // bounds are a discrete setBounds STEP).
  const guestBounds = entry.view.getBounds();
  const target = resolveTarget();
  // Defense-in-depth (F8 leg 4). The two creating callers cannot land here —
  // createWindow always returns a record — and the cross-window caller has
  // already refused a dead/absent/self target against the registry. A bare
  // `return` would be a silent death; DD5 forbids one, so this is an announced
  // refusal like any other.
  if (!target || target.win.isDestroyed() || target === source) return { ok: false, reason: 'no-target' };

  // Re-parent (DD1 spike primitive: destroy-free removeChildView → addChildView
  // across windows; webContents survives, wcId stable, live state intact).
  source.win.contentView.removeChildView(entry.view);
  target.win.contentView.addChildView(entry.view);
  // The seed is EXACT only for a move-created target (same content size by
  // construction). Moving into an EXISTING window of a different size seeds a
  // stale rect for one frame; the target's adopt-tab → activateTab → tab-set-active
  // re-sends the real bounds, which is the same correction every activation makes.
  entry.view.setBounds(guestBounds);
  entry.view.setVisible(true);

  // Move the tabViews entry between records + update activeTabWcId both sides.
  // Event-time class-3 routing (DD2) makes the per-tab main→chrome fan re-bind
  // to the target window automatically from this point on (verified per channel
  // by the leg's live sweep).
  // DD1 SYNCHRONY INVARIANT — NO SUSPENSION POINT may separate this delete from
  // the set below. Synchronous code between them is fine (it cannot yield); an
  // `await` is not. Across a yield the tab is in NEITHER record, and DD1's
  // "duplicate tabs are structurally impossible" degrades from a LOUD duplicate
  // to a SILENT MISSING TAB — quieter than the bug DD1 replaced. Adjacency is
  // NOT the invariant and is not pinned; this function staying synchronous is.
  // Pinned by test/unit/move-tab-synchrony.test.js — anchored on THIS function's
  // name, never a line number (F7 logged 4 different ones). Leg 1 anchored it on
  // the `'tab-move-to-new-window'` callback; F8 leg 3's factoring moved the pair
  // out, its vacuity guard failed loudly as designed, and forced this re-anchor.
  source.tabViews.delete(p.wcId);
  target.tabViews.set(p.wcId, entry);
  entry.active = true;
  if (source.activeTabWcId === p.wcId) source.activeTabWcId = null;
  // THE TARGET'S OUTGOING TAB IS HIDDEN HERE, AND THE MENU IS CLOSED HERE, because the
  // adopt round-trip that would otherwise do them is ASYNC:
  // adopt-tab → onAdoptTab → activateTab → tab-set-active arrives on a LATER turn. Until
  // it does, the target must never render two guests, so the core mirrors both effects
  // SYNCHRONOUSLY here, holding the interim to exactly one active / one visible guest —
  // the property leg 4's `tab-tearoff` row 8a asserts.
  //
  // The round-trip's `tab-set-active` guard (`owner.activeTabWcId !== null &&
  // owner.activeTabWcId !== wcId`) is now ARMED and RE-DOES both idempotently: we no
  // longer pre-set `target.activeTabWcId = p.wcId`, so `activeTabWcId` still holds the
  // OLD active tab when the round-trip lands, the guard is true, and its hide-old branch
  // and `closeMenuOverlay('tab-switch')` branch both fire (re-hiding an already-hidden
  // guest and re-closing an already-closed menu — no-ops). F8 DID pre-set it here, which
  // made that guard FALSE by round-trip time and forced the core to be the SOLE doer; that
  // pattern — disarm a guard, then hand-compensate for what it guarded — produced HIGH-1's
  // double-active and the re-shown stale menu, so F9 leg 1 removes the pre-set (F8 Rec 5).
  // The only thing the pre-set bought was a transient move-target caption (broadcastMove-
  // TargetsChanged reads each window's activeTabWcId); that stale label is doctrine-
  // sanctioned cosmetic ("can never mis-target") and self-heals on the round-trip's caption
  // broadcast (`tab-set-active` at the `broadcastMoveTargetsChanged()` call below it).
  //
  // TEAR-OFF NEVER SAW THE OLD DEFECT: a move-CREATED target is a `noBootTab` window whose
  // activeTabWcId is null, so there is no outgoing tab to hide. It is exclusive to the
  // move-into-an-EXISTING-window path (F8 leg 4), and at equal window sizes the moved tab
  // visually COVERS the stale guest — the silent wrong state this synchronous hide prevents.
  //
  // Read BEFORE any overwrite, and SYNCHRONOUSLY: no `await` may enter this function at all
  // (the DD1 pin above).
  const prevActive = target.activeTabWcId !== null ? target.tabViews.get(target.activeTabWcId) : null;
  if (prevActive && prevActive !== entry) {
    // Never read through a destroyed webContents — an uncaught throw in this area
    // wedges the Wayland close path permanently with zero error output (the F6 leg-4
    // root cause). The `active` flag is corrected either way: it is main-side state and
    // survives its view's destruction.
    if (!prevActive.view.webContents.isDestroyed()) prevActive.view.setVisible(false);
    prevActive.active = false;
    // AND CLOSE THE TARGET'S OPEN MENU HERE, FOR THE SAME REASON THE HIDE IS HERE: the
    // async round-trip cannot close it on THIS turn. `tab-set-active`'s guard
    // (`owner.activeTabWcId !== null && owner.activeTabWcId !== wcId`) gates TWO effects —
    // the outgoing-tab hide (mirrored just above) AND
    // `owner.sheet?.closeMenuOverlay('tab-switch')` — and, now that the guard is armed
    // (the pre-set is gone), re-closes the menu idempotently when the round-trip lands. The
    // core still closes it ITSELF, synchronously, so the target's stale menu (its active
    // guest changed underneath it) is never re-shown in the interim window. Idempotent when
    // no menu is open, and `target.sheet` is null-tolerant on a live record.
    target.sheet?.closeMenuOverlay('tab-switch');
  }

  // Focus rules (Chrome parity): the target window is raised and the moved tab is
  // active — true for a created window and for an existing one the tab is sent
  // into (Chrome raises the destination either way). Programmatic win.focus()
  // fires NO focus event under WSLg (spike verdict 4) — noteFocus seeds the DD8
  // accessor deterministically.
  target.win.focus();
  registry.noteFocus(target.win.id);

  // Source strip closes ranks NOW (the source chrome is booted — no barrier).
  const sourceCc = source.chromeView.webContents;
  if (!sourceCc.isDestroyed()) sourceCc.send('tab-moved-away', { wcId: p.wcId });

  // (H1) queue the target pair on the registry record — delivered only after
  // the target chrome's window-boot-config invoke is served. Thunks: the adopt
  // payload's main-authoritative url/title and the nav-state read off the live
  // wc at DELIVERY time.
  queueChromeSend(target, () => ['adopt-tab', buildAdoptPayload(p, wc)]);
  queueChromeSend(target, () => ['tab-nav-state', {
    wcId: p.wcId,
    canGoBack: !wc.isDestroyed() && wc.canGoBack(),
    canGoForward: !wc.isDestroyed() && wc.canGoForward(),
  }]);
  // Both records' active tab just changed, so both windows' captions did (DD8).
  // Synchronous sends, and AFTER the pair — never between it.
  broadcastMoveTargetsChanged();
  // (M09 F10 L3) EMPTY-SOURCE DISPOSAL. A sole-tab consolidate into an existing
  // window (allowSoleTab, the ONLY path that reaches this at size 0) left the
  // source with no tabs — close it. `size === 0` is SELF-SELECTING: only a
  // sole-tab move can empty the source, and that is only reachable with
  // allowSoleTab, so no path/allowSoleTab re-check is needed. LAST statement
  // before the return, AFTER broadcastMoveTargetsChanged so the target's adopt
  // queuing never depends on close() timing. Same shape as the window-close IPC
  // (win.close() on the sender's own window inside an IPC dispatch); the close
  // handler tolerates empty tabViews (its capture loop no-ops).
  if (source.tabViews.size === 0 && !source.win.isDestroyed()) source.win.close();
  return { ok: true, windowId: target.win.id };
}

// The MENU path (F6's, unchanged): narrows the core's result back to the bare
// `null` its renderer ignores and `renderer-globals.d.ts` declares.
ipcMain.handle('tab-move-to-new-window', (event, payload) => {
  const source = registry.getWindowForChrome(event.sender);
  if (!source) return null;
  const p = validateMoveTabPayload(payload);
  if (!p) return null;
  const r = moveTabIntoWindow(source, p, () => newWindowForMove(source));
  return r.ok ? r : null;
});

// The KEYBOARD CROSS-WINDOW path (F8 leg 4, DD8) — "Move to window …". The ONLY
// way a tab crosses windows in F8: the cross-window DRAG was deferred at leg 2
// (the transport is a cached fiction), and this path needs NO coordinate at all.
// Menu → windowId → main.
//
// THE AUTHORITY RULE, HONORED ON ITS OWN TERMS (DD8; main.js:270's rule restated).
// `payload.windowId` is a DESTINATION REQUEST and nothing more — never a claim of
// ownership, and never trusted as one:
//   - the SOURCE is resolved from `event.sender` through the registry, exactly as
//     the two paths above do it. The payload does not get to name it.
//   - the tab must be in THAT record's tabViews — the core's own `no-tab` guard.
//     A payload naming a tab the sender does not own is refused there, and the
//     registry is what refuses it.
//   - the TARGET is re-resolved through registry.get(). A window that closed
//     between menu build and this dispatch resolves to null and REFUSES (DD5) —
//     it never re-points at whichever window now sits where that one was. That
//     refusal is only reachable because DD8 keys the item on `windowId`; the
//     reversed ordinal scheme had to rebuild or cache the list to resolve one,
//     and both of those re-point silently.
ipcMain.handle('tab-move-to-window', (event, payload) => {
  const source = registry.getWindowForChrome(event.sender);
  if (!source) return { ok: false, reason: 'no-source' };
  const p = validateMoveTabPayload(payload);
  if (!p) return { ok: false, reason: 'bad-payload' };
  const wantedId = payload && typeof payload.windowId === 'number' ? payload.windowId : null;
  const target = wantedId === null ? null : registry.get(wantedId);
  // Resolved and refused HERE rather than inside the core: registry.get is a pure
  // lookup with no side effect to defer, and refusing before the core runs is what
  // keeps a refused move from closing the source's find session on its way out.
  if (!target || target.win.isDestroyed() || target === source) return { ok: false, reason: 'no-target' };
  // (M09 F10 L3) allowSoleTab: this is the EXISTING-window consolidate path — a
  // sole tab may move here, and the move core closes the emptied source. The two
  // newWindowForMove callers below do NOT pass it (sole-tab → new window is a
  // no-op swap, AC3).
  return moveTabIntoWindow(source, p, () => target, true);
});

// The DRAG path (F8 leg 3, DD5/DD16): a tab dragged out of the strip and released.
// The renderer decided "the pointer left the strip" against the strip's own rect in
// its OWN viewport and sends NO coordinate — this flight has no global coordinate.
// Returns the result verbatim; silence is not an outcome for a physical gesture.
ipcMain.handle('tab-tear-off', (event, payload) => {
  const source = registry.getWindowForChrome(event.sender);
  if (!source) return { ok: false, reason: 'no-source' };
  const p = validateMoveTabPayload(payload);
  if (!p) return { ok: false, reason: 'bad-payload' };
  return moveTabIntoWindow(source, p, () => newWindowForMove(source));
});

// DD2 PROVENANCE REGISTRATION (M09 F11 Leg 3). The drop-adopt below resolves its
// SOURCE from a payload-supplied wcId — any guest page can setData() our MIME with
// an arbitrary wcId, so the payload alone must not move a tab. These two chrome-only
// sends bookend a real drag: dragstart declares the wcId (verified against the
// SENDER's own tabViews — the payload does not get to name a tab the sender does not
// own), dragend clears it on a GRACE TIMER rather than immediately — the target's
// adopt invoke rides a different IPC pipe with no cross-pipe ordering guarantee, and
// an immediate clear could race a legitimate adopt into 'not-dragging'.
const DRAG_END_GRACE_MS = 1500;
// Pending grace-clear timers, PER RECORD: a fresh tab-drag-started cancels only its
// own record's pending clear. Keyed weakly so a record removed mid-drag (window
// closed) takes its timer entry with it — a timer that still fires then mutates an
// unreachable record, which is harmless (no cancel-on-close machinery needed).
/** @type {WeakMap<import('./window-registry').WindowRecord, ReturnType<typeof setTimeout>>} */
const dragEndClearTimers = new WeakMap();

ipcMain.on('tab-drag-started', (event, wcId) => {
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec || typeof wcId !== 'number' || !rec.tabViews.has(wcId)) return;
  const pending = dragEndClearTimers.get(rec);
  if (pending) { clearTimeout(pending); dragEndClearTimers.delete(rec); }
  rec.dragWcId = wcId;
});

ipcMain.on('tab-drag-ended', (event, wcId) => {
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec || rec.dragWcId !== wcId) return;
  const pending = dragEndClearTimers.get(rec);
  if (pending) clearTimeout(pending);
  dragEndClearTimers.set(rec, setTimeout(() => {
    dragEndClearTimers.delete(rec);
    rec.dragWcId = null;
  }, DRAG_END_GRACE_MS));
});

// The CROSS-WINDOW DROP path (M09 F11 Leg 3, DD1/DD2): a tab dragged from another
// window's strip and released on THIS window's strip. INVERTS tab-move-to-window's
// authority shape — source-from-payload, target-from-sender — which is exactly the
// DD2 weakening the provenance gate above closes: the resolved source must have
// DECLARED this wcId at dragstart, so a forged MIME payload dies at 'not-dragging'
// (guests cannot send tab-drag-started; the bridge is chrome-only). allowSoleTab:
// this is an existing-window consolidate (the F10 L3 ruling) — dragging a window's
// only tab moves it and the core closes the emptied source. Result verbatim (DD5).
ipcMain.handle('tab-adopt-by-drop', (event, payload) => {
  const target = registry.getWindowForChrome(event.sender);
  if (!target) return { ok: false, reason: 'no-source' };
  const p = validateMoveTabPayload(payload);
  if (!p) return { ok: false, reason: 'bad-payload' };
  const source = registry.getWindowForGuest(p.wcId);
  if (!source) return { ok: false, reason: 'no-tab' };
  // The renderer handles a same-window drop as reorder and guards the canceled-drag
  // corner itself; refusing here is defense-in-depth, not the primary gate.
  if (source === target) return { ok: false, reason: 'same-window' };
  if (source.dragWcId !== p.wcId) return { ok: false, reason: 'not-dragging' };
  const r = moveTabIntoWindow(source, p, () => target, true);
  if (r.ok) {
    // A successful adopt CONSUMES the registration (DD2 refinement): one drag = one
    // drop, shrinking the post-success forgery window to ~0.
    const pending = dragEndClearTimers.get(source);
    if (pending) { clearTimeout(pending); dragEndClearTimers.delete(source); }
    source.dragWcId = null;
  }
  return r;
});

ipcMain.on('tab-hide', (event, wcId) => {
  // Class 1 (F6 DD2): owner-record resolve replaces the singleton activeTabWcId.
  const owner = registry.getWindowForGuest(wcId);
  if (!owner) return;
  // Find-overlay hide (DD5): hiding the active guest (the pending-activation hide)
  // takes the overlay out of the stack too. Restore needs no code here —
  // late-activation lands in tab-set-active's re-add.
  // Menu-overlay close family (F8 DD4): hiding the active guest while a sheet menu
  // is open CLOSES the menu ('tab-hide'). The DD5 hook skips the find-restore for
  // this reason (the close runs BEFORE activeTabWcId is nulled below — a restore
  // here would paint the bar over a hidden guest).
  // F7 DD5: THIS owner window's OWN overlays — hiding window B's active guest cannot
  // reach window A's overlays, so the pre-F7 attachment conditioning is deleted.
  if (wcId === owner.activeTabWcId) {
    owner.findOverlay?.hide();
    owner.sheet?.closeMenuOverlay('tab-hide');
  }
  const entry = owner.tabViews.get(wcId);
  if (!entry) return;
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.setVisible(false);
  }
  entry.active = false;
  if (owner.activeTabWcId === wcId) owner.activeTabWcId = null;
});

ipcMain.on('tab-navigate', (_event, { wcId, verb, args }) => {
  const wc = getTabContents(wcId);
  if (!wc || wc.isDestroyed()) return;
  if (verb === 'loadURL' && args && args[0]) {
    wc.loadURL(args[0]).catch((err) => {
      logger.warn('[tab-navigate] loadURL rejected:', err && (err.code || err.message || err));
    });
  } else if (verb === 'reload') {
    wc.reload();
  } else if (verb === 'stop') {
    wc.stop();
  } else if (verb === 'goBack') {
    wc.goBack();
  } else if (verb === 'goForward') {
    wc.goForward();
  }
});

ipcMain.on('tab-set-active', (event, { wcId, bounds }) => {
  // Class 1 (F6 DD2): activation is scoped to the tab's OWNING window's record —
  // activating a tab in window 2 must not touch window 1's active state.
  const owner = registry.getWindowForGuest(wcId);
  if (!owner) return;
  // L2 (T3): capture whether the OUTGOING active guest holds OS focus BEFORE the
  // visibility swap below. isFocused() on the outgoing guest is exactly the "focus was in
  // the page" signal — a page-content chord leaves the outgoing guest focused, while strip
  // keyboard nav / find / sheet all leave it NOT focused. We re-focus the incoming guest
  // iff this is true (see below), so page-focused Ctrl+#/Ctrl+Tab keeps routing to a
  // guest's before-input-event; AC5 strip nav / find / sheet are preserved untouched.
  // getTabContents already null-guards a missing/destroyed guest.
  const wasPageFocused = owner.activeTabWcId != null && !!getTabContents(owner.activeTabWcId)?.isFocused();
  // Atomic: set-bounds → setVisible(true) incoming → setVisible(false) outgoing
  const entry = owner.tabViews.get(wcId);
  if (entry) {
    // Hoisted rounded bounds so the guest setBounds and the overlay bounds-sync below
    // share one object.
    const rounded = bounds
      ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }
      : null;
    if (rounded) {
      entry.view.setBounds(rounded);
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(true);
    }
    entry.active = true;
    // Raise the active guest view to the top so page input works.
    if (!owner.win.isDestroyed()) {
      owner.win.contentView.addChildView(entry.view);
    }
    // L2 (T3): re-arm keyboard routing — focus the INCOMING guest iff the OUTGOING was
    // page-focused (captured above), so a page-content Ctrl+#/Ctrl+Tab does not orphan OS
    // focus. Internal/trusted incoming tabs are focused too (deliberate: cycling INTO a
    // goldfinch:// page must not re-orphan focus).
    if (wasPageFocused && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.focus();
    }
    // Find-overlay z-order re-assert (DD2 invariant): strictly AFTER the guest re-add
    // above, or the guest buries the overlay. Do not "optimize" this away when the
    // overlay is already visible — every guest re-add raises the guest.
    // F7 DD5: the switch-away close reads THIS owner window's OWN find session — the
    // pre-F7 owner.tabViews.has(session) guard is structural now (the instance only
    // ever knows its own window's session), so activating a tab in window B cannot
    // close window A's live session.
    const sessionWcId = owner.findOverlay ? owner.findOverlay.getSessionTabWcId() : null;
    if (sessionWcId != null && wcId !== sessionWcId) {
      // AC6a: activating a DIFFERENT tab (internal or web alike — also covers DD7)
      // CLOSES the session: stopFind clearSelection on the old guest, hide, clear
      // state. NO refocus — the new guest was already added/raised above; refocusing
      // the OLD guest would land OS focus on a view about to be hidden and steal
      // focus from tab-strip keyboard navigation (AC5).
      owner.findOverlay.closeSession({ refocusGuest: false });
    } else if (owner.findOverlay?.isSessionActive(wcId)) {
      // AC6b / DD5 restore: re-activating the session's own tab re-shows the
      // overlay — the session survives a hide/re-add cycle.
      // isSessionActive(wcId) implies !entry.trusted (open refuses trusted).
      if (rounded) owner.findOverlay.syncBounds(rounded);
      owner.findOverlay.show();
    }
    // Menu-overlay sheet (F8 DD4/DD9/DD7): strictly AFTER the guest re-add AND the
    // find-overlay re-assert above, so the sheet sits top-of-stack. No entry.trusted
    // gate — the sheet serves internal tabs too (DD7).
    // F7 DD5: ALL three sheet touches below act on THIS owner window's OWN sheet —
    // window B's tab activity is structurally unable to move/close/re-raise window A's
    // menu, so the pre-F7 attachment conditioning is deleted (syncBounds stores always
    // regardless; closeMenuOverlay is idempotent when no menu is open).
    if (rounded) owner.sheet?.syncBounds(rounded);
    if (owner.activeTabWcId !== null && owner.activeTabWcId !== wcId) {
      // Close family: activating a DIFFERENT tab (any driver, incl. MCP activateTab —
      // the DD4 "never blurs the sheet" path) closes any open menu. The DD5 hook
      // skips the find-restore for 'tab-switch' — this handler's own per-tab
      // find-restore logic above governs.
      owner.sheet?.closeMenuOverlay('tab-switch');
    } else if (owner.sheet?.isMenuOpen()) {
      // Same-tab re-activation with a menu open: the re-add keeps the sheet
      // top-of-stack via re-add-last (the recorded attachment — never re-resolved).
      owner.sheet.show();
    }
    // Tear-off pill z-order re-assert (AC5): a tab activation MID-drag is rare, but the
    // guest re-add above buries the pill — re-show it (re-add RAISES) so it stays above.
    // Gated on visibility, so no cost when no tear-off is live. Strictly last: topmost.
    if (owner.tearoffOverlay?.isVisible()) owner.tearoffOverlay.show();
  }
  // Hide old active tab (within the owning window only)
  if (owner.activeTabWcId !== null && owner.activeTabWcId !== wcId) {
    const oldEntry = owner.tabViews.get(owner.activeTabWcId);
    if (oldEntry && !oldEntry.view.webContents.isDestroyed()) {
      oldEntry.view.setVisible(false);
    }
    if (oldEntry) oldEntry.active = false;
  }
  const captionChanged = owner.activeTabWcId !== wcId;
  owner.activeTabWcId = wcId;
  // F8 DD8: this window's caption is its ACTIVE tab's title, so an activation
  // retitles it for every OTHER window's menu. Gated on the active tab actually
  // changing — a re-activation of the same tab (the menu/find re-assert path
  // above) changes no caption.
  if (captionChanged) broadcastMoveTargetsChanged();
});

ipcMain.on('tab-set-bounds', (event, { wcId, bounds }) => {
  // Class 1 (F6 DD2): owner-record resolve for the active-tab compare below.
  const owner = registry.getWindowForGuest(wcId);
  const entry = owner ? owner.tabViews.get(wcId) : null;
  if (!entry || entry.view.webContents.isDestroyed()) return;
  const rounded = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
  entry.view.setBounds(rounded);
  // Find-overlay position-sync (DD2): the overlay tracks the ACTIVE guest's bounds —
  // resize/maximize/panel toggles all funnel here via sendActiveBounds/ResizeObserver/
  // trigger-send-bounds. F7 DD5 (recon S9): both syncBounds calls hit THIS owner
  // window's OWN managers, so window B's bounds churn cannot re-position window A's
  // find bar / menu — and, critically, the pre-F7 last-guest-bounds write went to a
  // SHARED module slot that every window's bounds churn polluted unconditionally (DD7
  // had fixed only the read). It is per-instance closure state now: each manager
  // stores always and applies only while visible.
  if (wcId === owner.activeTabWcId) {
    owner.findOverlay?.syncBounds(rounded);
    // Menu-overlay geometry-follow (F8 DD12): identity mapping — the sheet's bounds
    // ARE the active guest's rounded bounds.
    owner.sheet?.syncBounds(rounded);
  }
});

ipcMain.on('tab-find', (_event, { wcId, text, options, stop }) => {
  const wc = getTabContents(wcId);
  if (!wc || wc.isDestroyed()) return;
  if (stop) {
    wc.stopFindInPage(options || 'clearSelection');
  } else if (text) {
    wc.findInPage(text, options || {});
  }
});

}

module.exports = { registerTabIpc };
