/**
 * @typedef {{
 *   id: string,
 *   webview: Electron.WebviewTag | null,
 *   trusted: boolean,
 *   title: string,
 *   url: string,
 *   favicon: string | null,
 *   media: any[],
 *   selected: Set<string>,
 *   wcId: number | null,
 *   privacy: { net: any, fp: { canvas: number, webgl: number, audio: number }, permissions: any[], cookies: any },
 *   container: { id: string, name: string, color: string, partition: string, burner?: boolean },
 *   btn?: HTMLElement,
 *   findOpen?: boolean,
 *   findText?: string
 * }} Tab
 */

/**
 * Own the chrome tab map's strip representation, native drag session, guest
 * activation, cross-window adoption, and guest-slot geometry.
 *
 * The injected ctx.tabs Map remains the only renderer-side tab authority.
 * @param {any} deps
 */
export function createTabController(deps) {
  const {
    window, document, requestAnimationFrame, ResizeObserver,
    ctx, els, tabs, jarsClient,
    blankPrivacy, escapeHtml, openTabContextMenu, currentHomePage,
    isInternalPageUrl, isSafeTabUrl, resolveNewTabContainer, classifyDragPoint,
    announceTabStatus, updateNavButtons, refreshZoomControl, fetchCookies,
    closeSuggestions, resetSuggestionsForActivation, updateAddressChip,
    renderMedia, renderPrivacy, setDevtoolsPressed
  } = deps;
  // Trusted-tab pseudo-jar display name (Leg 3, ownership ruling from the Leg 1
  // design review — folded into DD3): every trusted internal tab used to hardcode
  // `name: 'Settings'`, which was fine for one internal page but wrong for the other
  // two (`goldfinch://downloads`, `goldfinch://jars`). Derive the label from the URL
  // host instead. This is ONLY the container tooltip/fallback (the dot title, the
  // automation-indicator fallback) — tab TITLES still come from the page `<title>`.
  // `id: 'internal'` and the internal-partition pairing (below) are UNCHANGED — that
  // pairing is the documented data-loss guard.
  const INTERNAL_JAR_NAMES = { settings: 'Settings', downloads: 'Downloads', jars: 'Cookie Jars' };
  function internalJarName(url) {
    try {
      return INTERNAL_JAR_NAMES[new URL(url).host] || 'Settings';
    } catch {
      return 'Settings';
    }
  }

  /**
   * Strip-record construction (M09 F6 Leg 4 — the review-M3 factoring), shared by
   * BOTH createTab and the adopt-tab branch: the tab object + tabs.set + the tab
   * button DOM + its listener set (click/auxclick/contextmenu/dragstart/dragend) +
   * strip append + the four title update points (tab-title text, tooltip,
   * aria-label, close-button aria-label) when an initial `title` is known.
   * Callers own everything else — URL gates, jar resolution, wcId provisioning
   * (createTab's tabCreate invoke vs adopt's direct assignment), insertAt,
   * activation.
   * @param {{ id: string, url: string, jar: Tab['container'], trusted: boolean, title?: string | null }} parts
   * @returns {Tab}
   */
  function buildStripRecord({ id, url, jar, trusted, title = null }) {
    // Both trusted (internal) and untrusted (web) tabs use WebContentsView via IPC (Leg 3).
    // tab.webview is null for all tabs; internal tabs use tab.wcId exactly like web tabs.
    const tab = {
      id,
      webview: null, // no <webview> element — all tabs are WebContentsViews (Leg 3)
      trusted,
      title: 'New tab',
      url,
      favicon: null,
      media: [],
      selected: new Set(),
      wcId: null,
      privacy: blankPrivacy(),
      container: jar
    };
    tabs.set(id, tab);

    // Tab button in the strip.
    const btn = document.createElement('div');
    btn.className = 'tab';
    btn.dataset.id = id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.tabIndex = -1;
    // aria-controls points at the shared content region (#webviews), the single container that
    // shows the active tab's content. Leg 1 migrated web tabs to native WebContentsViews (no
    // per-tab DOM node); Leg 3 migrates internal tabs the same way — #webviews is the one
    // element common to both, and the only non-dangling IDREF target.
    btn.setAttribute('aria-controls', 'webviews');
    // M09 F2 DD3: the reorder chord joins the existing close shortcut (space-separated
    // alternatives per the ARIA aria-keyshortcuts syntax).
    btn.setAttribute('aria-keyshortcuts', 'Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight');
    btn.setAttribute('aria-label', 'New tab');
    // Colored dot for every jar; the internal (Settings) pseudo-jar is chrome, not a
    // user container — no dot.
    const dot =
      jar.id === 'internal'
        ? ''
        : `<span class="tab-jar" style="background:${jar.color}" title="${escapeHtml(jar.name)}${jar.burner ? ' (burner)' : ''}"></span>`;
    // .tab-row wraps the visible content (flex row + padding): a CSS container query cannot
    // restyle the element that establishes the container itself, so the padding-compress
    // disclosure stage (styles.css) needs a descendant of `.tab` (the query container) to
    // target — see the styles.css comment above `.tab-row`.
    // favicon <img draggable="false"> (M09 F11 Leg 2): the native tab drag owns the
    // gesture — grabbing the favicon must drag the TAB, never start an image drag
    // (mirrors the lightbox img.draggable=false idiom).
    btn.innerHTML = `<span class="tab-row">${dot}<img class="tab-fav hidden" alt="" draggable="false" /><span class="tab-title">New tab</span><button class="tab-close" tabindex="-1" aria-label="Close tab: New tab">✕</button></span>`;
    // Native HTML5 DnD source (M09 F11 Leg 2): every tab is draggable at rest; the
    // dragstart/dragend handlers below own reorder + tear-off + the Leg 3 cross-window seam.
    btn.draggable = true;
    btn.addEventListener('click', (e) => {
      if (/** @type {HTMLElement} */ (e.target).closest('.tab-close')) {
        if (tabs.size > 1 && !isLastTab(id)) freezeTabWidths(); // DD5: defer reflow on pointer-close
        closeTab(id);
        return;
      }
      // Activation ruling (M09 F11 Leg 2): native HTML5 DnD does NOT fire a `click`
      // after a completed drag, so a plain click is the only thing that reaches here —
      // no click-suppression flag is needed (the drag path activates in `dragstart`).
      activateTab(id);
    });
    // Middle-click close (M09 F1 DD3): rides the identical deferred-reflow pointer-close path as
    // the ✕ button. Filter to button 1 (middle) — auxclick also fires for buttons 3/4 (back/
    // forward) which must no-op here. preventDefault documents intent (middle-click autoscroll is
    // already foreclosed by the chrome document's overflow:hidden).
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (tabs.size > 1 && !isLastTab(id)) freezeTabWidths();
      closeTab(id);
    });
    // Tab context menu (M09 F5 Leg 1, DD2): a real right-click AND the Context-Menu
    // key / Shift+F10 on a FOCUSED tab both deliver here (the single native
    // `contextmenu` event Chromium dispatches for both — the toolbar-pin-button
    // precedent). Menu open ≠ activation: this listener never calls activateTab, so
    // right-clicking (or Menu-keying) a BACKGROUND tab opens ITS menu without
    // switching to it.
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTabContextMenu(id, btn);
    });
    // Native drag SOURCE (M09 F11 Leg 2, DD3 unified rewrite): `dragstart`/`dragend`
    // on the tab own the whole gesture — reorder, tear-off, and the Leg 3 cross-window
    // seam. The old pointerdown drag-record + document pointermove/up/cancel state
    // machine is gone; native HTML5 DnD owns arming (no threshold), and the OS-native
    // drag image crosses window bounds (DD4).
    btn.addEventListener('dragstart', (e) => {
      const dt = e.dataTransfer;
      // wcId gate: a tab whose guest view has not been provisioned yet cannot be
      // identified across the IPC — refuse the drag rather than ship a null wcId.
      if (tab.wcId == null || !dt) { e.preventDefault(); return; }
      activateTab(id); // Chrome parity: dragging a background tab activates it
      // DD2 provenance (Leg 3): declare the drag main-side — the cross-window adopt
      // refuses a payload the source never declared. Bookended by tabDragEnded below.
      window.goldfinch.tabDragStarted(tab.wcId);
      // Identity payload — the EXACT shape validateMoveTabPayload + requestTearOff use
      // ({ wcId, url, title, favicon, container }); burner container + favicon are
      // renderer-only facts, so main cannot rebuild them from the wcId.
      dt.setData(TAB_DND_MIME, JSON.stringify({
        wcId: tab.wcId, url: tab.url, title: tab.title, favicon: tab.favicon, container: tab.container
      }));
      dt.effectAllowed = 'move';
      // Cursor-follow (DD3/DD4): the tab ITSELF is the drag image, offset to the grab point —
      // the OS-native image is the out-of-window feedback, so it must be snapshotted NOW,
      // while the tab is still opaque (the `.dragging` hole is deferred a frame, below).
      const r = btn.getBoundingClientRect();
      dt.setDragImage(btn, e.clientX - r.left, e.clientY - r.top);
      releaseTabWidths(); // the drag's own transforms own the geometry from here (clears any DD5 freeze)
      // Session snapshot: slot geometry is read ONCE here and stays valid for the whole
      // drag — displacement is transform-only, and transforms never reflow layout. Every
      // coordinate is WINDOW-LOCAL (DD16). stripRect is #tabstrip, not #tabs: a pointer
      // over the drag spacer or the window controls has NOT left the strip.
      const tabEls = orderedTabEls();
      const startOrder = tabEls.map((el) => el.dataset.id || '');
      const sr = els.tabstrip.getBoundingClientRect();
      dnd = {
        tabId: id,
        wcId: tab.wcId,
        startOrder,
        draggedIndex: startOrder.indexOf(id),
        slotRects: tabEls.map((el) => {
          const b = el.getBoundingClientRect();
          return { left: b.left, width: b.width };
        }),
        stripRect: { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom },
        currentDropIndex: null,
        tearOff: false,
        dropHandled: false,
      };
      // The opacity hole goes on the NEXT frame: setDragImage snapshots the element at the
      // end of the dragstart dispatch, so adding `.dragging` synchronously would capture an
      // invisible tab as the drag image.
      requestAnimationFrame(() => {
        if (dnd && dnd.tabId === id) btn.classList.add('dragging');
      });
    });
    // dragend: release-point tear-off disambiguation. A release that no strip `drop` handled
    // tears off when EITHER the dragover-latched `tearOff` flag is set OR the release point
    // itself classifies outside the strip — the flag alone misses fast boundary exits (the
    // last dragover can land back in the reorder zone a frame before the cursor leaves).
    // Escape mid-drag folds in here: the browser aborts the drag into dragend with no drop,
    // and the unhandled in-strip release announces the cancel. Coordinates are WINDOW-LOCAL
    // e.clientX/clientY (DD16-clean — NEVER screenX).
    btn.addEventListener('dragend', (e) => {
      // DD2 provenance bookend — BEFORE the null-`dnd` early return, so a drag whose
      // session was defensively canceled mid-gesture still ends its registration (main
      // clears on a grace timer; a just-dispatched adopt cannot race into 'not-dragging',
      // and a consumed registration makes this a no-op).
      if (tab.wcId != null) window.goldfinch.tabDragEnded(tab.wcId);
      if (!dnd) return;
      const tabId = dnd.tabId;
      const wasCommitted = dnd.dropHandled;
      const releaseZone = classifyDragPoint(
        /** @type {{left:number,top:number,right:number,bottom:number}} */ (dnd.stripRect),
        /** @type {{left:number,width:number}[]} */ (dnd.slotRects),
        e.clientX, e.clientY, dnd.draggedIndex);
      const doTearOff = !dnd.dropHandled && (dnd.tearOff || releaseZone.zone === 'tearOff');
      clearDragVisuals();
      dnd = null; // SYNCHRONOUS — the tear-off request the session outlives must never read a live `dnd`
      if (doTearOff) requestTearOff(tabId);
      else if (!wasCommitted) announceTabStatus('Move canceled');
    });
    els.tabs.appendChild(btn);
    tab.btn = btn;

    // Initial title seed (M09 F4 Leg 2, DD2 step 4 — reopen/duplicate; M09 F6 adopt):
    // apply the four title update points instead of flashing "New tab" — mirrors
    // onTabTitle's own update set so a restored/adopted tab looks indistinguishable
    // from one that already received its first page-title-updated event.
    if (typeof title === 'string' && title) {
      tab.title = title;
      tab.btn.querySelector('.tab-title').textContent = title;
      tab.btn.title = title;
      tab.btn.setAttribute('aria-label', title);
      const closeBtn = tab.btn.querySelector('.tab-close');
      if (closeBtn) closeBtn.setAttribute('aria-label', `Close tab: ${title}`);
    }

    return tab;
  }

  // M09 F4 Leg 2 (DD2 step 3): `restoreHistory` and `insertAt` are the reopen-chain's
  // two additive optional fields — every existing call site (which never passes
  // them) is unaffected. `restoreHistory: {entries, index, title}` rides straight
  // through to the `tab-create` IPC payload (main branches on its presence, DD2
  // step 4); `title` is read HERE (renderer-side only, stripped of no further
  // meaning to main) to seed the initial strip title. `insertAt` lands the tab at
  // its ORIGINAL strip position via the existing commitTabMove machinery (F2 DD1).
  function createTab(url = currentHomePage(), container = null, { trusted = false, restoreHistory = null, insertAt = null } = {}) {
    // Defensive drag-cancel (M09 F2 Leg 2 Edge Case): the only tab-list mutation paths are
    // closeTab/createTab; either one invalidates a live drag's slotRects snapshot mid-gesture.
    if (dnd) cancelDnd();
    // Provenance is the CALL SITE, never the URL: trusted is an explicit caller arg.
    // The untrusted branch validates with isSafeTabUrl (which rejects `goldfinch://`),
    // so web content reaching here via onOpenTab can never select the internal branch.
    const ok = trusted ? isInternalPageUrl(url) : isSafeTabUrl(url);
    if (!ok) return null;
    const id = `tab-${++ctx.tabSeq}`;
    // ⚠️ DATA-LOSS TRAP: the synthetic internal jar is set as the `jar` ITSELF — one object
    // that the webview `partition` attribute, `tab.container`, AND the dot logic all derive
    // from. If the partition were set to the internal string while tab.container stayed the
    // resolved default, a New Identity click on the Settings tab would wipe the user's real
    // `persist:goldfinch` jar (identity-new reads tab.container.partition).
    const jar = trusted
      ? { id: 'internal', name: internalJarName(url), color: '#9aa0ac', partition: window.goldfinch.internalPartition }
      : container || resolveNewTabContainer(jarsClient.containers, jarsClient.defaultId) || jarsClient.makeBurner();

    // Strip-record construction extracted (M09 F6 Leg 4, review M3): shared with
    // the adopt-tab branch. The initial-title seed covers the reopen/duplicate
    // restoreHistory case (M09 F4 DD2 step 4 — the same condition as before).
    const tab = buildStripRecord({
      id,
      url,
      jar,
      trusted,
      title: restoreHistory && typeof restoreHistory.title === 'string' && restoreHistory.title
        ? restoreHistory.title
        : null
    });

    // M09 F4 Leg 2 (DD2 step 3): `insertAt` lands the reopened tab at its ORIGINAL
    // strip position (Chrome parity). The tab is already appended (last slot), so
    // this is a one-shot move via the existing commitTabMove (F2 DD1) machinery.
    // Clamped to [0, current-max] against the top end — commitTabMove's own
    // `|| null` append-at-end fallback already handles "past the end" gracefully.
    // A negative insertAt (the capture-side -1 sentinel for "position unknown at
    // capture time") is treated as "no move" — the tab stays appended at the end
    // rather than being clamped up to position 0, which would misrepresent an
    // unknown position as "was first".
    if (Number.isInteger(insertAt) && insertAt >= 0) {
      const maxIndex = orderedTabIds().length - 1;
      commitTabMove(id, Math.min(insertAt, maxIndex));
    }

    // All tabs (web and internal) use WebContentsView via IPC (Leg 3).
    // For internal tabs: trusted:true causes main to construct with internal webPreferences
    // (internal-preload.js, contextIsolation:true, sandbox:true, partition:INTERNAL_PARTITION).
    // For web tabs: trusted:false → web prefs (webview-preload.js, contextIsolation:false).
    // restoreHistory (M09 F4 Leg 2, DD2 step 3/4, additive/optional) rides straight
    // through to main — main's tab-create handler branches on its presence to skip
    // loadURL and call navigationHistory.restore() instead.
    window.goldfinch.tabCreate({ url, partition: jar.partition, trusted, ...(restoreHistory ? { restoreHistory } : {}) }).then((wcId) => {
      if (!tabs.has(id)) return; // tab was closed before wcId arrived
      tab.wcId = wcId;
      // If this tab is still active, refresh state now that wcId is available.
      if (tab.id === ctx.activeTabId) {
        // Make the WebContentsView visible now that its wcId has arrived.
        // activateTab() ran synchronously in createTab() with wcId still null,
        // so the tab-set-active IPC was skipped — send it here to show the view.
        // Full slot: find never insets the guest (DD8 — the overlay floats).
        window.goldfinch.tabSetActive(tab.wcId, measureWebviewsSlotDIP());
        // Track the now-visible view (web or internal) for the outgoing-hide path.
        ctx.activeViewWcId = tab.wcId;
        updateNavButtons();
        refreshZoomControl(tab);
        if (!els.privacyPanel.classList.contains('collapsed')) {
          fetchCookies();
        }
      }
    });

    activateTab(id);
    return tab;
  }

  // orderedTabIds() (M09 F2 DD1): the single accessor for DOM-order tab ids — the
  // pure `tabs` Map is id→tab lookup only; its insertion order is NOT load-bearing
  // after this flight (a tab can move without ever leaving/re-entering the Map).
  // Reads `els.tabs` children rather than trusting the Map, and filters to `.tab`
  // elements so any future non-tab child of the strip can't corrupt the order.
  function orderedTabIds() {
    return [...els.tabs.children]
      .filter((el) => el.classList.contains('tab'))
      .map((el) => /** @type {HTMLElement} */ (el).dataset.id);
  }

  // commitTabMove(id, targetIndex) (M09 F2 DD1): DOM move commit helper, shared with
  // next leg's pointer-drop. `targetIndex` is the tab's index in the FINAL DOM order
  // (as produced by the pure tab-order model). insertBefore-based: an instant step,
  // no animation (matches the DD5 commit-step idiom used elsewhere in the strip).
  function commitTabMove(id, targetIndex) {
    const tab = tabs.get(id);
    if (!tab || !tab.btn) return;
    const tabEls = [...els.tabs.children].filter((el) => el.classList.contains('tab'));
    const withoutMoving = tabEls.filter((el) => el !== tab.btn);
    // The element that should immediately FOLLOW the moved tab in the final order is
    // withoutMoving[targetIndex] (see tab-order.js's dropIndexFromPointer semantics —
    // targetIndex counts positions among the OTHER slots). null (past the end) appends.
    const referenceEl = withoutMoving[targetIndex] || null;
    els.tabs.insertBefore(tab.btn, referenceEl);
  }

  // ------------------------------------------------------------ native tab drag (M09 F11 Leg 2)
  //
  // DD3 (unified rewrite): all tab drags are native HTML5 DnD — ONE gesture for reorder,
  // tear-off, and cross-window drop, no modifier. `dragstart` snapshots the session (per-tab,
  // above); `dragover` recomputes the reorder/tearoff preview; `drop` ships a same-window
  // reorder; `dragend` runs the tear-off disambiguation gate. Native DnD owns arming (no
  // pointer threshold, no `shouldArm`), and the OS-native drag image crosses window bounds
  // (DD4) — replacing the old pointer state machine (pointerdown record + document
  // pointermove/up/cancel) wholesale. Transport + disambiguation are spike-validated (Leg 1
  // probes 2–4). Module-scoped `dnd` session (null when idle).
  //
  // M09 F8's SECOND AXIS + zone survives (DD16): inside #tabstrip it reorders, released
  // outside it tears off — the zone decision stays pure (tab-drag-zone.js). Every coordinate
  // is WINDOW-LOCAL — `e.clientX/Y` against this window's own rects, never
  // `screenX`/`getBounds`/`screen`, which the spike measured to be a cached fiction on this rig.
  /**
   * The live drag session, snapshotted at dragstart (null when idle). `startOrder`/`slotRects`/
   * `draggedIndex` are the arm-time slot geometry the displacement preview and the drop commit
   * both read; `currentDropIndex` is the last dragover's reorder index (null until the first
   * displacement, and re-nulled while the tear-off zone is latched); `tearOff` is the dragover-
   * latched zone flag dragend disambiguates on; `dropHandled` is set synchronously by the strip
   * `drop` handler so dragend does not tear off a committed move.
   * @type {{ tabId: string, wcId: number, startOrder: string[], draggedIndex: number,
   *   slotRects: {left:number,width:number}[],
   *   stripRect: {left:number,top:number,right:number,bottom:number},
   *   currentDropIndex: number|null, tearOff: boolean, dropHandled: boolean }|null} */
  let dnd = null;

  // The tear-off round-trip's state (DD6) — SEPARATE from `dnd` and carrying NO visual state,
  // so all `cancelDnd()` sites stay no-ops across it and none can fire a false 'Move canceled'
  // on a SUCCESSFUL move. It is the freshness test: a reply whose `dropSeq` is not the current
  // record's is discarded, leaving main the sole authority on what happened.
  //
  // DD6's "any strip mutation clears it" is NARROWED to mutations of a DIFFERENT tab: a
  // tear-off's own success arrives as `tab-moved-away` for the pending tab BEFORE its reply
  // lands, and clearing there would make our own success read as stale and silence the
  // announcement DD5 requires. The leak DD6 guarded against cannot happen — `invoke` always
  // settles and the `.then` always clears.
  let dropSeq = 0;
  /** @type {{ dropSeq: number, tabId: string }|null} */
  let pendingDrop = null;

  /** The `.tab` elements in current DOM order (element form of orderedTabIds()). */
  function orderedTabEls() {
    return /** @type {HTMLElement[]} */ ([...els.tabs.children].filter((el) => el.classList.contains('tab')));
  }

  /** Clear every tab's drag-visual state (inline transform + `.dragging`/`.detaching` classes). */
  function clearDragVisuals() {
    for (const t of tabs.values()) {
      if (!t.btn) continue;
      t.btn.style.transform = '';
      t.btn.classList.remove('dragging');
      t.btn.classList.remove('detaching');
    }
  }

  /**
   * Recompute and apply sibling transforms for the current drop index (DD2 Chrome idiom —
   * the opening gap IS the live drop indication; transforms only, never layout). Rebuilds
   * the hypothetical final order (the dragged tab inserted at `targetIndex` among the
   * remaining slots — the SAME semantics commitTabMove's own `targetIndex` parameter uses,
   * so this previews exactly what the eventual commit will produce) and, for every OTHER
   * tab, translates it by the delta between its ORIGINAL slot rect (snapshotted at
   * dragstart — transforms never reflow layout, so the snapshot stays valid for the whole
   * drag) and the slot rect it now visually occupies. Exact for non-uniform tab widths
   * (sliver counts) — not an approximation via a single shared slot width.
   * @param {number} targetIndex
   */
  function applyDragDisplacement(targetIndex) {
    if (!dnd) return;
    const { tabId, startOrder, slotRects, draggedIndex } = dnd;
    const remainingIds = startOrder.filter((_, i) => i !== draggedIndex);
    const refId = remainingIds[targetIndex];
    const finalOrder = refId != null
      ? [...remainingIds.slice(0, targetIndex), tabId, ...remainingIds.slice(targetIndex)]
      : [...remainingIds, tabId];
    finalOrder.forEach((tid, finalIdx) => {
      if (tid === tabId) return; // the dragged tab is the native drag image; its slot is the `.dragging` opacity hole
      const t = tabs.get(tid);
      if (!t || !t.btn) return;
      const origIdx = startOrder.indexOf(tid);
      const delta = slotRects[finalIdx].left - slotRects[origIdx].left;
      t.btn.style.transform = delta ? `translateX(${delta}px)` : '';
    });
  }

  /**
   * Detach-pending displacement: the pointer left the strip, so the siblings close ranks as
   * though the tab were already gone — the SAME slot assignment as a drop past the last slot
   * (above, `refId == null` puts the dragged tab last and the loop skips it either way), so
   * the reorder path is reused rather than its delta loop transcribed.
   */
  function applyDetachDisplacement() {
    if (dnd) applyDragDisplacement(dnd.startOrder.length - 1);
  }

  /** Abort the live drag: clear the drag visuals (transforms + classes — nothing else was
   * ever touched, so restore is free), drop the session, and announce. */
  function cancelDnd() {
    if (!dnd) return;
    clearDragVisuals();
    dnd = null;
    announceTabStatus('Move canceled');
  }

  const TAB_DND_MIME = 'application/x-goldfinch-tab';
  // Document-level `dragover` (NOT #tabs, and that is the mechanism, not a shortcut): accept
  // this window's own tab drag so the OS keeps the drag alive, and recompute the reorder/
  // tear-off preview. Tear-off detection needs pointer points OUTSIDE #tabstrip, and #tabs ⊂
  // #tabstrip — a #tabs-scoped listener would feed classifyDragPoint only in-strip points and
  // could never classify tearOff. NO ghost pill (retired — DD4 amend: the native drag image is
  // the out-of-window feedback). Coordinates stay WINDOW-LOCAL (DD16).
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes(TAB_DND_MIME)) return;
    // Accepted UNCONDITIONALLY for the MIME (Leg 3): a FOREIGN window's drag must be
    // accepted here or its `drop` never fires — the OS delivers a drop only to a window
    // whose dragover preventDefault()ed. The zone/displacement body below stays gated on
    // this window's OWN `dnd` (source-window-only preview).
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move'; // MANDATORY (spike probe3) — else the drop is silently rejected
    if (!dnd) return; // not this window's own drag — no zone work for a foreign one
    const zone = classifyDragPoint(
      dnd.stripRect, dnd.slotRects,
      e.clientX, e.clientY, dnd.draggedIndex);
    const tab = tabs.get(dnd.tabId);
    if (zone.zone === 'tearOff') {
      if (!dnd.tearOff) { // latch once per zone entry — the class add + close-ranks are idempotent per entry
        dnd.tearOff = true;
        dnd.currentDropIndex = null; // force a displacement recompute on the way back into the strip
        if (tab && tab.btn) tab.btn.classList.add('detaching');
        applyDetachDisplacement();
      }
      return;
    }
    if (dnd.tearOff) {
      dnd.tearOff = false; // back inside the strip — the reorder preview takes over
      if (tab && tab.btn) tab.btn.classList.remove('detaching');
    }
    if (zone.index !== dnd.currentDropIndex) {
      dnd.currentDropIndex = zone.index;
      applyDragDisplacement(zone.index);
    }
  });
  // `drop` on #tabs (the no-drag drop target — #tabstrip's app-region:drag background cannot
  // receive it): `dropHandled` is set SYNCHRONOUSLY (drop fires before dragend) so `dragend`
  // does not tear off a committed move. A same-window payload commits the reorder at the last
  // dragover's drop index; the announce fires only when the order actually changed (a drop
  // back into the original slot is not a move).
  els.tabs.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes(TAB_DND_MIME)) return;
    e.preventDefault();
    if (dnd) dnd.dropHandled = true;
    // The full identity-payload shape rides through to tabAdoptByDrop on the foreign
    // branch; the same-window branch reads only wcId.
    /** @type {{ wcId: number, url: string, title: string, favicon: string | null,
     *   container: { id: string, name: string, color: string, partition: string, burner?: boolean } }|null} */
    let payload;
    try {
      payload = JSON.parse(e.dataTransfer.getData(TAB_DND_MIME));
    } catch {
      payload = null; // malformed payload — treat as not-ours
    }
    if (!payload || typeof payload.wcId !== 'number') return;
    if (dnd && payload.wcId === dnd.wcId) {
      const tabId = dnd.tabId;
      const targetIndex = dnd.currentDropIndex ?? dnd.draggedIndex;
      const before = orderedTabIds();
      clearDragVisuals(); // the committed DOM order replaces the transform preview of it
      commitTabMove(tabId, targetIndex);
      const after = orderedTabIds();
      if (after.join(' ') !== before.join(' ')) {
        announceTabStatus(`Tab moved to position ${after.indexOf(tabId) + 1} of ${after.length}`);
      }
      return;
    }
    // Cross-window adopt (Leg 3, DD1): a foreign drag's payload — adopt it into THIS
    // window via the new IPC and announce the result HERE (leg DD4: the target owns the
    // authoritative reply; the source suppresses its own tear-off's no-tab echo).
    // Null-`dnd`-own-tab guard first: the payload naming one of THIS window's own tabs
    // with no live session is a mid-drag-canceled same-window release (a popup createTab
    // or tab-close ran cancelDnd under the native drag) — silent no-op, main's
    // 'same-window' refusal stays as defense-in-depth, never invoked spuriously.
    if (!dnd && findTabByWcId(payload.wcId)) return;
    window.goldfinch.tabAdoptByDrop(payload).then((result) => {
      announceTabStatus(moveOutcomeMessage(result, 'this window'));
    });
  });
  // Escape mid-drag: the PRIMARY path is native — the browser aborts the drag and fires
  // `dragend` (no drop) → `Move canceled` (keydown is not dispatched to the page during a native
  // drag loop). This listener is the defensive parity site: it cancels cleanly if an Escape ever
  // reaches the page with a live `dnd`.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dnd) {
      e.preventDefault();
      cancelDnd();
    }
  });
  // (F11 Leg 2) No resize→cancelDnd under native DnD: a native drag captures the pointer, so a
  // manual mid-drag resize is impossible; the WSLg spurious resize on cursor-exit was racing
  // dragend and canceling tear-offs.

  /**
   * Dispatch a tear-off drop (DD5/DD6). Takes only a tabId, so it cannot come to depend on the
   * drag session it outlives. Payload is this renderer's strip snapshot (the menu path's —
   * burner container and favicon exist only here); NO coordinate rides it.
   * @param {string} tabId
   */
  function requestTearOff(tabId) {
    const tab = tabs.get(tabId);
    if (!tab || tab.wcId == null) return; // nothing to move — the strip mutated under the drag
    const seq = ++dropSeq;
    pendingDrop = { dropSeq: seq, tabId };
    window.goldfinch.tabTearOff({
      wcId: tab.wcId, url: tab.url, title: tab.title, favicon: tab.favicon, container: tab.container
    }).then((result) => {
      // Still ours? A newer drop, or a strip mutation under us, invalidated this reply.
      if (!pendingDrop || pendingDrop.dropSeq !== seq) return;
      pendingDrop = null;
      // Adopted-elsewhere signature (Leg 3, leg DD4): a successful cross-window drop
      // reads `no-tab` here — the target's adopt moved the tab before this tear-off
      // dispatched, and `tab-moved-away` (sent during the adopt, earlier on this same
      // ordered pipe) has already emptied the local map. The TARGET announced the
      // outcome, so this is suppressed — a `no-tab` with the tab STILL PRESENT is a
      // true anomaly and stays announced.
      if (result && result.ok === false && result.reason === 'no-tab' && !tabs.has(tabId)) return;
      // DD5: EVERY outcome is announced. On success `tab-moved-away` has already removed the
      // tab, so this announcement is all that is left to do either way.
      announceTabStatus(moveOutcomeMessage(result, 'a new window'));
    });
  }

  /**
   * The screen-reader announcement for a tab move — tear-off or cross-window (DD5: silence is
   * not an outcome). ONE map over the move core's ONE result union, parameterized by the
   * destination phrase.
   *
   * IT IS SHARED BECAUSE THE JUSTIFICATION FOR NOT SHARING IT DID NOT SURVIVE BEING CHECKED.
   * Leg 4 first wrote a second, near-duplicate map on the stated grounds that "the reason
   * vocabulary overlaps but every message differs". Held up against the two drafts, they are
   * the SAME sentences over a different destination. Sharing them is the argument the move
   * core itself makes one screen up — share ONE move, not two transcriptions of it — and it
   * applies to the thing that DESCRIBES the move as much as to the move.
   *
   * TOTAL by construction: a default arm plus a final fallthrough, so no input reaches an
   * implicit `undefined` return. That totality, not the wording, is what makes silence
   * unreachable, and it is what the invariants suite pins.
   *
   * `no-target` is reachable only on the cross-window path — tear-off always creates its own
   * destination, so it cannot hit it. The map is total over the CORE'S union rather than over
   * any one caller's reachable subset, which is why that arm is here and harmless.
   * @param {{ ok: true, windowId: number }|{ ok: false, reason: string }|null|undefined} result
   * @param {string} dest  the destination as the sentence needs it ('a new window' / 'another window')
   * @returns {string}
   */
  function moveOutcomeMessage(result, dest) {
    if (result && result.ok === false) {
      switch (result.reason) {
        case 'no-target': return 'That window is no longer open — the tab was not moved';
        case 'sole-tab': return `Cannot move the only tab to ${dest}`;
        case 'internal': return `This tab cannot be moved to ${dest}`;
        default: return `Move to ${dest} failed`;
      }
    }
    if (result && result.ok) return `Tab moved to ${dest}`;
    return `Move to ${dest} failed`; // no reply at all — still an outcome, never silence
  }

  function closeTab(id) {
    // Defensive drag-cancel (M09 F2 Leg 2 Edge Case): a tab-list mutation during a live drag
    // invalidates its slotRects snapshot regardless of which tab this close targets.
    if (dnd) cancelDnd();
    if (pendingDrop && pendingDrop.tabId !== id) pendingDrop = null; // DD6 narrowed — see the pendingDrop note
    const tab = tabs.get(id);
    if (!tab) return;
    // M09 F4 Leg 1: snapshot the strip position BEFORE DOM removal below —
    // orderedTabIds() reads live `#tabstrip` children, so capturing this AFTER
    // `tab.btn.remove()` would always yield -1 (Architect second-pass nit).
    // Rides the tabClose bridge so main can record it on the closed-tab-stack
    // entry for positional reopen (DD2).
    const stripIndex = orderedTabIds().indexOf(id);
    // All tabs are WebContentsViews (Leg 3). Internal tabs (trusted) use tabClose just like web tabs.
    if (tab.wcId != null) {
      if (tab.wcId === ctx.activeViewWcId) ctx.activeViewWcId = null;
      window.goldfinch.tabClose(tab.wcId, stripIndex);
    }
    tab.btn.remove();
    tabs.delete(id);

    if (ctx.activeTabId === id) {
      // DD1: DOM order is authoritative — orderedTabIds() reads the current strip,
      // NOT Map insertion order (which no longer necessarily matches visual order
      // once a tab has been reordered).
      const next = orderedTabIds().pop();
      if (next) activateTab(next);
      else createTab(); // never leave the window with zero tabs
    }
  }

  function activateTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    ctx.activeTabId = id;

    // Suggestions invalidation (design review, HIGH): bump suggest.seq on EVERY
    // activation, unconditionally — an in-flight historySuggest response for the
    // PREVIOUS tab's jar must never paint after switching (acceptSuggestResponse
    // rejects it on the seq mismatch). Also reset local paint state immediately;
    // in the ordinary case (tab.wcId already set) main already closes the sheet
    // on tab-switch (tab-set-active → closeMenuOverlay('tab-switch')) — do NOT
    // double-send the close IPC here, the async Ch7 confirms this same reset.
    resetSuggestionsForActivation();

    for (const t of tabs.values()) {
      const isActive = t.id === id;
      // All tabs (web + internal) are WebContentsViews; visibility managed via tab-set-active IPC.
      t.btn.classList.toggle('active', isActive);
      t.btn.setAttribute('aria-selected', String(isActive));
      t.btn.tabIndex = isActive ? 0 : -1;
    }

    els.address.value = tab.url || '';
    updateAddressChip(tab);
    refreshZoomControl(tab);

    if (tab.wcId != null) {
      // Send tab-set-active with bounds (main handles visibility + hides the previous
      // view — and closes any prior overlay find session on a switch). Full slot: find
      // never insets the guest (DD8 — the overlay floats over it).
      window.goldfinch.tabSetActive(tab.wcId, measureWebviewsSlotDIP());
      // Track the now-visible view (web or internal) for the outgoing-hide path.
      ctx.activeViewWcId = tab.wcId;
      // Per-tab find restore (DD9): re-open the overlay session with this tab's saved
      // text. MUST be sent AFTER tabSetActive — same sender, so IPC delivery order is
      // guaranteed, and main's tab-set-active switch-close then precedes this reopen.
      // Do NOT defer into a .then()/rAF: interleaving with a second fast switch would
      // break the ordering that makes an A→B→A double-switch safe. Tabs without
      // findOpen need no else-branch — main already closed the session on the switch.
      if (tab.findOpen && !isInternalTab(tab)) {
        window.goldfinch.findOverlayOpen({ wcId: tab.wcId, findText: tab.findText || '' });
      }
    } else {
      // wcId not yet arrived — hide the outgoing view while we wait; the tabCreate .then()
      // sends tabSetActive once wcId is available. Read the tracker BEFORE clearing.
      if (ctx.activeViewWcId != null) window.goldfinch.tabHide(ctx.activeViewWcId);
      ctx.activeViewWcId = null;
      // Brand-new-tab path (design review, MEDIUM): createTab's synchronous
      // activateTab() call runs before any tab-set-active IPC reaches main (wcId
      // is still null here), so main's tab-switch close never fires in this
      // window — close explicitly (no-op if nothing was open).
      closeSuggestions('navigation');
    }
    renderMedia();
    renderPrivacy();
    // Cookies are fetched on demand when the Privacy panel opens. On tab switch the
    // panel re-renders but does not re-fetch — kick one off for web tabs whose cookies
    // are still null so the Cookies section doesn't stay "Loading…".
    if (
      !els.privacyPanel.classList.contains('collapsed') &&
      isWebTab(tab) &&
      tab.privacy &&
      tab.privacy.cookies == null
    ) {
      fetchCookies();
    }
    updateNavButtons();

    // Tab-scoped toolbar disable (HAT polish). The pinnable buttons (Media, Shields,
    // DevTools) act on the active tab's web content, so they are functionally inert on
    // goldfinch:// internal tabs. Drive the native `disabled` property from the active
    // tab type so the existing `.icon-btn:disabled` style dims them automatically.
    // This is SEPARATE from applyToolbarPins (pin-driven visibility, DD5) — disabled
    // state is tab-activation-driven. Switching back to a web tab re-enables all three.
    const internal = isInternalTab(tab);
    els.toggleMedia.disabled = internal;
    els.togglePrivacy.disabled = internal;
    els.toggleDevtools.disabled = internal;

    // DevTools pressed-state reconcile (DD3 rebuild trigger (b): tab activation).
    // Query the newly-active tab's live open state; the ctx.activeTabId === tab.id re-check
    // guards the async isDevtoolsOpen promise against a fast double-switch painting the
    // wrong tab's state. Internal / no-wcId tabs force pressed false (button is inert there).
    if (!isInternalTab(tab) && tab.wcId != null) {
      window.goldfinch.isDevtoolsOpen({ webContentsId: tab.wcId })
        .then((open) => { if (ctx.activeTabId === tab.id) setDevtoolsPressed(!!open); })
        .catch(() => {});
    } else {
      setDevtoolsPressed(false);
    }
  }

  function activeTab() {
    return tabs.get(ctx.activeTabId) || null;
  }

  /** @param {Tab|null} tab @returns {boolean} */
  function isInternalTab(tab) {
    // tab.container.id === 'internal' is set at the createTab trusted branch (~467)
    // when { trusted: true } is passed. Keep these two sites in sync. (DD5)
    return !!(
      tab &&
      tab.container &&
      (tab.container.id === 'internal' || tab.container.partition === window.goldfinch.internalPartition)
    );
  }

  /** @param {Tab|null} tab @returns {boolean} */
  function isWebTab(tab) { return !isInternalTab(tab); }

  // Is `id` the last (rightmost) tab in DOM order? A pointer-close of the last tab must
  // NOT freeze widths (issue #97): with no right neighbour to slide into the vacated slot,
  // #newtab-pill shifts left under the stationary cursor and — because the pill lives inside
  // #tabstrip — the #tabstrip mouseleave that releases the freeze can never fire, wedging the
  // shrunken widths and capturing subsequent clicks on the pill. Reflowing immediately instead
  // lets the new last tab's ✕ expand back out toward the cursor (serial-close parity with the
  // mid-list case). DOM order is authoritative — orderedTabIds() reads the live strip.
  function isLastTab(id) {
    const ids = orderedTabIds();
    return ids[ids.length - 1] === id;
  }

  let widthsFrozen = false;
  // Deferred resize-on-close (DD5): freeze remaining tabs' rendered widths so a pointer-close
  // doesn't reflow the strip out from under the cursor. Released on #tabstrip mouseleave.
  function freezeTabWidths() {
    for (const t of tabs.values()) {
      t.btn.style.flex = `0 0 ${t.btn.getBoundingClientRect().width}px`;
    }
    widthsFrozen = true;
  }
  function releaseTabWidths() {
    if (!widthsFrozen) return;
    for (const t of tabs.values()) t.btn.style.flex = '';
    widthsFrozen = false;
  }
  els.tabstrip.addEventListener('mouseleave', releaseTabWidths);

  // Measure the webviews slot in DIP coordinates (no devicePixelRatio division —
  // getBoundingClientRect() already returns DIP on Electron/Chromium).
  function measureWebviewsSlotDIP() {
    const r = els.webviews.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }

  // The guest is never inset (DD8, M05 F7): find — formerly the only inset contributor
  // (computeTopInsetDIP/measureWebviewsSlotWithInsetDIP, deleted at the F7 cutover) —
  // now floats as a main-owned overlay WebContentsView above the full-bounds guest.
  // Menus float the same way on the menu-overlay sheet (M05 F8) — the guest stays
  // live at full bounds under an open menu.

  // Debounced geometry send: sends the active web tab's bounds after a rAF,
  // coalescing multiple rapid calls (resize, panel toggle) into one send.
  function sendActiveBounds() {
    if (ctx.rafGeometryPending) return;
    ctx.rafGeometryPending = true;
    requestAnimationFrame(() => {
      ctx.rafGeometryPending = false;
      const t = activeTab();
      // All active views (web AND internal) need geometry updates on resize/panel-toggle —
      // internal tabs are WebContentsViews now (Leg 3), not <webview> elements. Excluding
      // internal here stranded them at stale bounds until a tabSetActive (tab switch) re-bounded
      // them. Always the full slot: find never insets the guest (DD8 — the overlay floats).
      if (t && t.wcId != null) {
        window.goldfinch.tabSetBounds(t.wcId, measureWebviewsSlotDIP());
      }
    });
  }

  // wireWebview removed (Leg 3): all tabs — web and internal — are now WebContentsViews;
  // no <webview> elements are constructed and wireWebview is unreachable. Tab-strip events
  // (navigate, title, favicon, load, find) are forwarded from main via wireTabViewEvents +
  // the module-level onTab* IPC subscriptions. No `will-attach-webview` handler or `webviewTag`
  // option remains — the `<webview>` machinery was removed when tabs moved to WebContentsView (M05 F3).

  // ---------------------------------------------------------------------------
  // Move-to-new-window branches (M09 F6 Leg 4, DD5 step 3). BOTH registrations
  // sit at module top level, ABOVE the boot gate (review H1): the
  // window-boot-config invoke that releases main's queued adopt-tab can only be
  // issued after this module finishes evaluating, so these subscriptions provably
  // exist before any adopt-tab/tab-moved-away arrives.
  // ---------------------------------------------------------------------------

  // adopt-tab (TARGET chrome): strip insertion WITHOUT createTab — the
  // webContents already lives (true re-parenting; construction is not an option).
  // The payload is everything the strip needs (H2/M4: main-authoritative
  // url/title; renderer-only favicon + FULL container object, so burner tabs are
  // adoptable) — no follow-up round-trip. Deliberately re-derived/lost on move
  // (documented): media list (repopulates on the next tab-media-list push), find
  // state (the session closed with the source binding), privacy aggregate
  // (repopulates on the next privacy-net).
  window.goldfinch.onAdoptTab((payload) => {
    if (!payload || typeof payload.wcId !== 'number') return;
    if (!payload.container || typeof payload.container !== 'object') return;
    if (findTabByWcId(payload.wcId)) return; // already adopted — defensive no-op
    if (dnd) cancelDnd(); // tab-list mutation invalidates a live drag's snapshot
    pendingDrop = null; // DD6: an adopt is never the pending tab's own success — always invalidates
    const id = `tab-${++ctx.tabSeq}`;
    const tab = buildStripRecord({
      id,
      url: typeof payload.url === 'string' ? payload.url : '',
      jar: payload.container,
      trusted: false, // internal tabs never move (model omission + main refusal, M4)
      title: typeof payload.title === 'string' && payload.title ? payload.title : null
    });
    // Direct wcId assignment (review M3): no tabCreate invoke, no provisioning
    // .then — the guest view was re-parented main-side before this send.
    tab.wcId = payload.wcId;
    if (typeof payload.favicon === 'string' && payload.favicon) {
      tab.favicon = payload.favicon;
      const img = /** @type {HTMLImageElement|null} */ (tab.btn.querySelector('.tab-fav'));
      if (img) { img.src = payload.favicon; img.classList.remove('hidden'); }
    }
    // Focus rules: the moved tab is this window's active tab (Chrome parity).
    // activateTab sends tab-set-active with THIS window's measured slot bounds —
    // correcting the main-side H3 seed against any chrome-layout delta.
    activateTab(id);
  });

  // tab-moved-away (SOURCE chrome): strip removal WITHOUT destroy — mirrors
  // closeTab FIELD BY FIELD minus the stack/IPC pieces: cancelDnd, button
  // remove, tabs.delete, the ctx.activeViewWcId clear, the next-activation fallback.
  // NO stripIndex snapshot, NO tabClose IPC, NO closed-tab capture (the tab is
  // alive in another window). The ctx.activeViewWcId clear is load-bearing (review
  // M3's named cross-window bug): a stale ctx.activeViewWcId here would tabHide the
  // moved guest IN THE TARGET WINDOW on this window's next activation.
  window.goldfinch.onTabMovedAway((payload) => {
    if (!payload || typeof payload.wcId !== 'number') return;
    const tab = findTabByWcId(payload.wcId);
    if (!tab) return;
    // Leg 3 silent-clear (leg DD4): the departing tab IS the live drag session tab — a
    // successful cross-window adopt beat our own dragend, and the TARGET announces that
    // outcome. Clear WITHOUT the Move-canceled announce (the defensive cancel below then
    // no-ops on the null session). NOTE this region sits past the maskComments regex
    // blind spot (see sole-tab-move-close-source.test.js) — keep this comment quote-free.
    if (dnd && dnd.wcId === payload.wcId) { clearDragVisuals(); dnd = null; }
    if (dnd) cancelDnd();
    // DD6 narrowed (see the pendingDrop note): this fires on the tear-off SUCCESS path, for the
    // pending tab, BEFORE its reply lands — clearing here would silence our own success.
    if (pendingDrop && pendingDrop.tabId !== tab.id) pendingDrop = null;
    if (tab.wcId === ctx.activeViewWcId) ctx.activeViewWcId = null;
    tab.btn.remove();
    tabs.delete(tab.id);
    if (ctx.activeTabId === tab.id) {
      // DD1: DOM order is authoritative — same fallback as closeTab. NO
      // else-createTab arm (M09 F10 L3): an empty-strip tab-moved-away now means
      // main is CLOSING this window (the sole-tab consolidate path closes the
      // emptied source), so booting a tab would race a tab-create into a closing
      // window (orphan-guest leak). The non-empty branch is all that remains.
      const next = orderedTabIds().pop();
      if (next) activateTab(next);
    }
  });

  // ResizeObserver: send updated bounds to the active web tab when the webviews slot resizes.
  const webviewsSlotObserver = new ResizeObserver(() => sendActiveBounds());
  webviewsSlotObserver.observe(els.webviews);

  // ---------------------------------------------------------------------------
  // FIX 1 belt-and-suspenders (D-GEOMETRY): immediately re-measure + resend bounds
  // when main signals that the window was maximized/unmaximized/resized. This bypasses
  // the rAF guard for the case where the chrome view itself has just been resized by
  // main (before the ResizeObserver fires with settled layout). Does NOT coalesce —
  // it sends the current layout immediately, trusting that main sent the signal only
  // after applying chromeView.setBounds (so layout is stable).
  window.goldfinch.onTriggerSendBounds(() => {
    // Force a fresh measurement, bypassing the rAF coalescing guard.
    // Re-schedule a rAF-based send too for the settled-layout measurement.
    ctx.rafGeometryPending = false;  // cancel any pending rAF (it was reading stale bounds)
    sendActiveBounds();          // reschedule with fresh pending
  });


  function findTabByWcId(id) {
    for (const tab of tabs.values()) if (tab.wcId === id) return tab;
    return null;
  }

  return {
    createTab,
    closeTab,
    activateTab,
    activeTab,
    findTabByWcId,
    isInternalTab,
    isWebTab,
    orderedTabIds,
    commitTabMove,
    moveOutcomeMessage,
    releaseTabWidths,
    measureWebviewsSlotDIP,
    sendActiveBounds
  };
}
