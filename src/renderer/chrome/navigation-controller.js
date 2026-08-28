/** @typedef {any} Tab */

/** @param {any} deps */
export function createNavigationController(deps) {
  const {
    window,
    document,
    ctx,
    els,
    activeTab,
    findTabByWcId, // M17 F1 L2 (DD7): resolves a tab-did-navigate wcId to its tab record for the focus-handoff one-shot
    isInternalTab,
    isWebTab,
    createTab,
    openDownloads,
    openNewTab,
    attachView, // M16 F2 Leg 1: the `+` pill (DD4) / navigate() on a welcome tab (DD2)
    openWelcomeTab,
    refreshWelcome, // M16 F2 Leg 2 (DD3): the search handoff — a new welcome tab beside the page, or an in-place re-render
    bookmarksClient,
    buildSearchUrl,
    currentSearchEngine,
    capPendingQuery,
    normalizeHomePageInput, // M16 F1 Leg 2 / F2 Leg 2 / F3 Leg 2: toUrl's search fallback + the pending-query cap + the shared domain-normalize rule (HAT item 5)
    isInternalPageUrl,
    shouldQuery,
    buildSuggestionModel,
    mergeSuggestionSources,
    moveSelection,
    acceptSuggestResponse,
    suggestionsState,
    closeOverlayMenu,
    openOverlayMenu,
    leftAnchorOf
  } = deps;
  function updateAddressChip(tab) {
    const chip = els.addressChip;
    const url = tab && tab.url;

    if (!url || url === 'about:blank') {
      // Neutral default: new/blank tab — web state with generic label
      chip.removeAttribute('data-state');
      chip.removeAttribute('data-secure');
      chip.setAttribute('aria-label', 'Site information');
      els.address.readOnly = false;
      return;
    }

    if (isInternalPageUrl(url)) {
      chip.setAttribute('data-state', 'internal');
      chip.removeAttribute('data-secure');
      chip.setAttribute('aria-label', 'Secure Goldfinch page');
      els.address.readOnly = true;
      return;
    }

    // Web tab: parse the host for the label; guard against unparseable URLs
    let host;
    try {
      host = new URL(url).host;
    } catch {
      // Unparseable URL — fall back to neutral default
      chip.removeAttribute('data-state');
      chip.removeAttribute('data-secure');
      chip.setAttribute('aria-label', 'Site information');
      els.address.readOnly = false;
      return;
    }
    const secure = /^https:/i.test(url);
    chip.setAttribute('data-state', 'web');
    chip.setAttribute('data-secure', secure ? 'true' : 'false');
    chip.setAttribute(
      'aria-label',
      host ? (secure ? `Site information, ${host}` : `Site information, ${host}, not secure`) : 'Site information'
    );
    els.address.readOnly = false;
  }

  function updateNavButtons() {
    const tab = activeTab();
    if (!tab) {
      els.back.disabled = true;
      els.forward.disabled = true;
      return;
    }
    // Internal tabs never have navigation history; a viewless (welcome) record
    // has none yet either (M16 F2 Leg 1, DD7) — disable both explicitly in
    // either case. (No webview to query; tab-nav-state IPC is not sent for
    // internal views or for a tab with no wcId.)
    if (isInternalTab(tab) || tab.wcId == null) {
      els.back.disabled = true;
      els.forward.disabled = true;
    }
    // For web tabs with a live view: nav state is pushed via onTabNavState; buttons stay at last known state
  }

  /* ---------------------------------------------------------------- navigation */

  // M16 F2 Leg 2 (DD3): merged navigate() body — ORDER MATTERS (design review):
  // (1) empty/whitespace input is not a search and not a URL — no handoff, no
  // navigation, no welcome tab (NEW: there was no such guard before; Enter on
  // an empty bar used to search for ''); (2) the null-engine search check runs
  // BEFORE the welcome-record attach branch — attachView(tab, null) would
  // silently drop the query, so a search with no engine chosen must be routed
  // to handoffSearch first even when the active tab is already a welcome
  // record; (3) leg 1's welcome-record attach, now reached only for a real
  // URL; (4) the existing internal-tab lock and web-tab tabNavigate tail,
  // unchanged.
  function navigate(input) {
    const tab = activeTab();
    if (!tab) return;
    const s = input.trim();
    if (s === '') return;
    const url = toUrl(s);
    // Capture site 1/2 (DD3): capPendingQuery caps the query to PENDING_QUERY_MAX before it ever reaches the record.
    if (url == null) {
      handoffSearch(tab, capPendingQuery(s));
      return;
    }
    // M16 F2 Leg 1 (DD2): a viewless welcome record acquires its view on its
    // first navigation, whatever the entry point — attachView validates the
    // URL and runs the shared onViewCreated continuation once it resolves.
    if (tab.wcId == null && tab.welcome) {
      attachView(tab, url);
      return;
    }
    // Internal-tab navigation lock (DD6): after toUrl resolution, check whether the
    // active tab is an internal (goldfinch://) tab. If so, reroute any web URL to a
    // new normal tab and leave the internal tab untouched. The address bar is readOnly,
    // so real user entry here is belt-and-suspenders (the bar's readOnly prevents
    // direct user input, but navigate() could theoretically be invoked programmatically).
    if (isInternalTab(tab)) {
      if (!isInternalPageUrl(url)) {
        createTab(url); // open web URL in a NEW normal tab (untrusted/web branch)
      }
      // Whether the URL was internal (belt-and-suspenders no-op) or web (rerouted above),
      // never free-navigate the internal tab via the address bar.
      return;
    }
    // Internal tabs are handled by the isInternalTab early-return above; only web tabs reach here.
    if (isWebTab(tab) && tab.wcId != null) {
      window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'loadURL', args: [url] });
    }
  }

  // handoffSearch(tab, query) (M16 F2 Leg 2, DD3): a search typed with no
  // engine chosen. An active welcome record gets the reason and query added
  // IN PLACE (latest query wins — re-render via refreshWelcome); otherwise a
  // NEW welcome tab opens beside the page the user is on, in the same jar —
  // the search is never lost and the page the user was viewing is never
  // discarded.
  function handoffSearch(tab, query) {
    if (tab.wcId == null && tab.welcome) {
      tab.welcome.reasons.add('search');
      tab.welcome.pendingQuery = query;
      refreshWelcome(tab);
      return;
    }
    openWelcomeTab({ container: tab.container, reasons: ['search'], pendingQuery: query });
  }

  function toUrl(input) {
    const s = input.trim();
    if (/^[a-z]+:\/\//i.test(s) || s.startsWith('about:')) return s;
    // Looks like a domain? (has a dot, no spaces) — M16 F3 Leg 2 (HAT item
    // 5): delegates to the shared normalizeHomePageInput rule (the same rule
    // the welcome surface's and Settings' home-page fields now apply) rather
    // than keeping a second copy of the regex. The `about:`/scheme guard
    // above is NOT part of that shared helper and must stay first — an
    // `about:blank` must never fall through to the search branch below.
    const n = normalizeHomePageInput(s);
    if (n !== s) return n;
    // M16 F2 Leg 2 (DD3): a search with no engine chosen returns null — the
    // caller (navigate()) routes a null return to the welcome handoff instead
    // of ever resolving a query into a URL nobody chose a provider for. The
    // removed engine fallback is gone — this was the app's last
    // engine-coalescing read site.
    const engine = currentSearchEngine();
    if (engine == null) return null;
    return buildSearchUrl(engine, s);
  }

  /* --------------------------------------------------- focus-handoff on commit */
  // M17 F1 L2 (DD7): Enter in the address bar focuses the page once the
  // navigation the user just requested COMMITS. A one-shot keyed by the
  // logical TAB id, not the wcId: on a welcome tab, navigate() goes through
  // attachView(tab, url) and the guest's wcId does not exist until
  // tabCreate() resolves (tab-controller.js), so matching by tab id covers
  // that most-common flow (new tab → type URL → Enter) without a second hook
  // into attachView. Armed by the Enter handler below (both branches, right
  // after blur()); a single module-scoped slot — the next arm silently
  // replaces any still-pending one, which is exactly how a same-URL/hash-only
  // navigation or a search-query Enter (neither ever fires tab-did-navigate)
  // "expires": nothing ever matches, and it sits inert until overwritten or
  // cleared. Cleared on tab switch through resetSuggestionsForActivation
  // below, the SAME activation-class site that already resets suggest state.
  let pendingFocusGuest = null;

  function armFocusGuestOneShot() {
    const tab = activeTab();
    pendingFocusGuest = tab ? { tabId: tab.id } : null;
  }

  // The controller subscribes to goldfinch.onTabDidNavigate ITSELF (the
  // shortcut-controller.js onTabBoundary precedent) — the bridge's onXxx
  // listeners are additive (plain ipcRenderer.on), so renderer.js's own
  // module-level onTabDidNavigate subscriber (url-cache / address-chip /
  // find bookkeeping) is untouched and both fire on the same push.
  window.goldfinch.onTabDidNavigate(({ wcId }) => {
    if (!pendingFocusGuest) return;
    const record = findTabByWcId(wcId);
    if (!record || record.id !== pendingFocusGuest.tabId) return; // a different tab's wcId
    if (record.id !== ctx.activeTabId) return; // the armed tab is no longer active
    if (document.activeElement === els.address) return; // the operator re-focused the address bar
    pendingFocusGuest = null;
    window.goldfinch.focusActiveGuest();
  });

  /* ------------------------------------------------------- omnibox suggestions */
  // Suggestions controller (M08 Flight 4 Leg 3 / flight DD5): chrome-owned
  // state, combobox-like. The pure decision module
  // (../shared/omnibox-suggest-model.js) holds the query gate, model building,
  // selection clamping, and the response-time revalidation gate — this block
  // only wires events (renderer.js growth discipline). `suggestionsState()`
  // (registered above, with the other menu entries) is the SINGLE SOURCE OF
  // TRUTH for open/closed (design review Q3 ruling) — no local `open` flag here.
  const SUGGEST_DEBOUNCE_MS = 100;
  const SUGGEST_BLUR_GRACE_MS = 150;
  const suggest = { seq: 0, items: [], selectedIndex: -1, graceTimer: null, debounceTimer: null, lastQuery: '' };

  function cancelSuggestTimers() {
    if (suggest.graceTimer) {
      clearTimeout(suggest.graceTimer);
      suggest.graceTimer = null;
    }
    if (suggest.debounceTimer) {
      clearTimeout(suggest.debounceTimer);
      suggest.debounceTimer = null;
    }
  }

  // Full local-state reset — cancels both timers and clears the painted rows/
  // selection. Called by closeSuggestions() (every chrome-initiated close),
  // the Ch7 sink above (every main-initiated close, plus the tail of an
  // 'activated' close once Ch6 has read `suggest.items`), and activateTab
  // (tab-switch invalidation).
  function resetSuggestState() {
    cancelSuggestTimers();
    suggest.items = [];
    suggest.selectedIndex = -1;
    els.suggestStatus.textContent = ''; // M17 F1 L3 (DD12): covers every close/switch path below
  }

  function resetSuggestionsForActivation() {
    suggest.seq++;
    resetSuggestState();
    // M17 F1 L2 (DD7): tab-switch clear for the Enter-focus-handoff one-shot —
    // the same activation-class site (tab-controller.js's activateTab) that
    // already invalidates in-flight suggestions.
    pendingFocusGuest = null;
  }

  // The query-gate snapshot for the CURRENT moment — shared by the input
  // listener's initial gate and the response-time revalidation gate
  // (acceptSuggestResponse). Burner/internal tabs never query (structural).
  function suggestGateNow() {
    const tab = activeTab();
    return shouldQuery({
      focused: document.activeElement === els.address,
      isInternal: isInternalTab(tab),
      isBurner: !!(tab && tab.container && tab.container.burner),
      value: els.address.value
    });
  }

  // Close helper: no-op unless open (reads the single source of truth); sends
  // the channel-2 close, then resets local state immediately — the async Ch7
  // round-trip will also reset it (idempotent), but this avoids a visible
  // stale-row flash while it's in flight.
  /** @param {'escape' | 'blur' | 'navigation' | 'input-empty' | 'activated'} reason */
  function closeSuggestions(reason) {
    if (!suggestionsState().open) return;
    closeOverlayMenu(reason);
    resetSuggestState();
  }

  // Address-bar left edge, sheet-translated — the same leftAnchorOf idiom the
  // ▾ and 🔒 triggers use; y:0 (flush at the sheet top, DD12).
  const suggestAnchor = () => leftAnchorOf(els.address);

  // Paint (or re-paint on selection move) suggest.items/selectedIndex as a
  // model-replace — always noFocus (DD2): keyboard/programmatic updates never
  // move OS focus off #address.
  function paintSuggestions() {
    const model = buildSuggestionModel(suggest.items, suggest.selectedIndex);
    els.suggestStatus.textContent = model.announcement; // M17 F1 L3 (DD12): before opening
    openOverlayMenu('suggestions', model, suggestAnchor(), 0, { noFocus: true });
  }

  // Select-all on first click into a populated, non-readOnly address bar
  // (browser convention — Ruling R1, HAT step 2): a mousedown that is what's
  // FOCUSING the input (not already the active element) preventDefault()s the
  // default cursor-placement and programmatically focus()+select()s instead.
  // A second click while already focused falls through to normal cursor
  // placement. readOnly (internal goldfinch:// tabs) is left alone entirely.
  // Mirrors the existing Ctrl+L (`focus-address`) focus()+select() pair.
  els.address.addEventListener('mousedown', (e) => {
    if (els.address.readOnly) return; // internal tabs: leave alone
    if (document.activeElement === els.address) return; // already focused → normal cursor placement
    e.preventDefault();
    els.address.focus();
    els.address.select();
  });

  // Query gate + 100 ms debounce + token/seq guard. `{ok:false}` responses close
  // if open, never throw.
  els.address.addEventListener('input', () => {
    cancelSuggestTimers();
    const value = els.address.value;
    if (value.trim() === '') {
      closeSuggestions('input-empty'); // close trigger: input emptied
      return;
    }
    if (!suggestGateNow()) return; // not focused / internal / burner tab — never query
    suggest.debounceTimer = setTimeout(() => {
      suggest.debounceTimer = null;
      const tab = activeTab();
      if (!tab) return;
      const requestSeq = ++suggest.seq;
      suggest.lastQuery = value;
      // DD11: history + bookmarks are queried TOGETHER via Promise.allSettled —
      // deliberately NOT Promise.all (design-review correction): a rejected or
      // {ok:false} source degrades to [] independently, so a bookmarks-side
      // failure never blanks history results (and vice versa) — the pair
      // never fails closed.
      Promise.allSettled([
        window.goldfinch.historySuggest({ jarId: tab.container.id, query: value }),
        // M15 F2 L3: bookmarks are jar-scoped now too — the active tab's jar,
        // beside historySuggest's own (DD7/AC "Omnibox").
        window.goldfinch.bookmarksSuggest({ jarId: tab.container.id, query: value })
      ]).then(([historyOutcome, bookmarksOutcome]) => {
        // Response-time gate revalidation (flight DD5 HIGH, the kebab-while-
        // typing race): a stale response must never model-replace a menu the
        // operator opened meanwhile.
        const gateNow = suggestGateNow();
        if (!acceptSuggestResponse({ requestSeq, currentSeq: suggest.seq, gateNow })) return;
        const historyRes = historyOutcome.status === 'fulfilled' ? historyOutcome.value : null;
        const bookmarksRes = bookmarksOutcome.status === 'fulfilled' ? bookmarksOutcome.value : null;
        const historyRows =
          historyRes && historyRes.ok === true && Array.isArray(historyRes.suggestions) ? historyRes.suggestions : [];
        const bookmarkRows =
          bookmarksRes && bookmarksRes.ok === true && Array.isArray(bookmarksRes.suggestions)
            ? bookmarksRes.suggestions
            : [];
        suggest.items = mergeSuggestionSources(bookmarkRows, historyRows);
        suggest.selectedIndex = -1;
        paintSuggestions();
      });
    }, SUGGEST_DEBOUNCE_MS);
  });

  // Close trigger: address blur — a 150 ms grace timer (design review, HIGH):
  // a pointer click on a sheet row moves OS focus to the sheet BEFORE the row's
  // Ch4 activation lands at main, racing this blur; the grace window lets Ch6
  // win the race (the Ch7 sink above cancels this timer the instant the real
  // 'activated' close arrives). The callback re-checks BOTH the captured token
  // (a newer suggestions session opened within the window must not be closed by
  // the stale timer) AND document.activeElement (the operator came back —
  // retype, the in-bar zoom buttons, Ctrl+L — none of which mint a new token).
  els.address.addEventListener('blur', () => {
    if (!suggestionsState().open) return;
    const tokenAtBlur = suggestionsState().token;
    if (suggest.graceTimer) clearTimeout(suggest.graceTimer);
    suggest.graceTimer = setTimeout(() => {
      suggest.graceTimer = null;
      if (suggestionsState().token !== tokenAtBlur) return; // a newer session opened within the window
      if (document.activeElement === els.address) return; // the operator came back
      closeSuggestions('blur');
    }, SUGGEST_BLUR_GRACE_MS);
  });

  // The existing lone Enter handler grows (leg contract) to cover the full
  // keyboard contract: ArrowDown/ArrowUp move the selection and re-open
  // (model-replace, still noFocus); Enter with a selection navigates it; Enter
  // without one is the EXISTING behavior, byte-identical; Escape closes without
  // moving focus/clearing text.
  els.address.addEventListener('keydown', (e) => {
    const open = suggestionsState().open;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      suggest.selectedIndex = moveSelection(
        suggest.selectedIndex,
        e.key === 'ArrowDown' ? 1 : -1,
        suggest.items.length
      );
      paintSuggestions();
      return;
    }
    if (open && e.key === 'Escape') {
      e.preventDefault(); // input keeps focus and text
      closeSuggestions('escape');
      return;
    }
    if (e.key === 'Enter') {
      if (open && suggest.selectedIndex >= 0 && suggest.items[suggest.selectedIndex]) {
        const item = suggest.items[suggest.selectedIndex];
        closeSuggestions('activated');
        navigate(item.url);
        els.address.blur();
        armFocusGuestOneShot(); // DD7
        return;
      }
      // Existing behavior — byte-identical when no suggestion is selected.
      navigate(els.address.value);
      els.address.blur();
      armFocusGuestOneShot(); // DD7
    }
  });
  els.back.addEventListener('click', () => {
    const t = activeTab();
    if (!t) return;
    // Internal tabs have back disabled; web tabs use the view IPC path.
    if (isWebTab(t) && t.wcId != null) {
      window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'goBack', args: [] });
    }
  });
  els.forward.addEventListener('click', () => {
    const t = activeTab();
    if (!t) return;
    // Internal tabs have forward disabled; web tabs use the view IPC path.
    if (isWebTab(t) && t.wcId != null) {
      window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'goForward', args: [] });
    }
  });
  els.reload.addEventListener('click', () => {
    const t = activeTab();
    if (!t) return;
    // Internal tabs: reload button is not wired (no navigation history to stop/reload).
    if (isWebTab(t) && t.wcId != null) {
      if (els.reload.textContent === '✕') window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'stop', args: [] });
      else window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
    }
  });
  els.newTab.addEventListener('click', () => openNewTab()); // M16 F2 Leg 1 (DD4)
  // The ▾ container-picker toggle is registered with its own gate branch (Leg 3):
  // gate OFF in the container-picker section (chrome-DOM menu), gate ON in the
  // menu-overlay sheet branch (menuType 'container').

  /* ------------------------------------------------------------------ page zoom */

  // The address-bar zoom label is QUERY-DRIVEN, not cache-driven (DD1 stale-cache fix).
  // Chromium's per-origin host-zoom map re-zooms ALL same-origin tabs in a jar when ANY
  // one is zoomed, but only the active tab gets a zoom-changed broadcast — so a cached
  // factor map went stale for non-active same-origin tabs (their label stuck at the last
  // value they happened to be told about). Instead, refreshZoomControl() asks main for
  // the tab's LIVE engine zoom (`window.goldfinch.getZoom`) on every event that can change
  // the displayed value (tab activation, load completion, zoom change). No cache to go
  // stale. onZoomChanged compares wcIds directly to decide "is this the active tab".

  // Timer that clears the post-change "peek" reveal of the zoom control. Cleared and
  // restarted on each zoom change so back-to-back changes keep the control visible.
  /** @type {ReturnType<typeof setTimeout>|null} */
  let zoomPeekTimer = null;
  const ZOOM_PEEK_MS = 1500;

  /**
   * Sync the in-address-bar zoom control to a tab: hide it entirely on internal tabs,
   * else QUERY the tab's live engine zoom factor and render it as a percentage (always —
   * even at 100%). The query is authoritative (the cache is retired) so a non-active
   * same-origin tab that was implicitly re-zoomed shows the correct shared %.
   * Race guard: the active tab is captured before the await and the result is dropped if
   * the user switched tabs while the query was in flight (an async result for a
   * since-switched tab must not overwrite the now-active tab's label).
   * Visibility/fade is CSS-driven (hover / focus-within / .zoom-control--peek); this
   * only sets the percentage text and the internal-tab hidden state.
   * @param {Tab|null} tab
   */
  async function refreshZoomControl(tab) {
    if (!tab || isInternalTab(tab) || tab.wcId == null) {
      els.zoomControl.classList.add('hidden');
      return;
    }
    els.zoomControl.classList.remove('hidden');
    const queriedId = tab.id;
    const factor = await window.goldfinch.getZoom({ webContentsId: tab.wcId });
    // Drop the result if the active tab changed while the query was in flight.
    if (queriedId !== ctx.activeTabId) return;
    const pct = Math.round((factor ?? 1.0) * 100) + '%';
    els.zoomPercent.textContent = pct;
    els.zoomPercent.setAttribute('aria-label', `Current zoom ${pct}`);
  }

  /**
   * Sync the address-bar star to a tab (M15 F1 Leg 2, modeled on
   * refreshZoomControl above — including its hidden-early-return shape; jar-
   * resolved M15 F2 Leg 3): hidden entirely on internal tabs, BURNER tabs
   * (L3-DD-C — star suppression rides this same hide branch), or a tab with
   * no live wcId; else `ensureJar` primes the tab's jar's cache (once per
   * unseen jar — a no-op once cached) and a SYNCHRONOUS cache lookup scoped
   * to that jar (no async race guard needed, unlike the zoom control's live
   * IPC query) sets the filled state. `aria-pressed` reflects fill state;
   * `title`/`aria-label` are static (set once in index.html, the toolbar
   * "Label (Chord)" convention) — only the pressed state and the `.starred`
   * fill-color class change here.
   * @param {Tab|null} tab
   */
  function refreshStar(tab) {
    if (!tab || isInternalTab(tab) || tab.wcId == null || (tab.container && tab.container.burner)) {
      els.star.classList.add('hidden');
      return;
    }
    els.star.classList.remove('hidden');
    const jarId = tab.container && tab.container.id;
    if (bookmarksClient && jarId != null) bookmarksClient.ensureJar(jarId);
    const filled = !!(bookmarksClient && jarId != null && bookmarksClient.findByUrl(jarId, tab.url));
    els.star.setAttribute('aria-pressed', String(filled));
    els.star.classList.toggle('starred', filled);
  }

  window.goldfinch.onZoomChanged(({ wcId }) => {
    const t = activeTab();
    // Compare wcIds directly — the value is queried live, the broadcast is only the
    // "something changed, re-query" signal for the active tab.
    if (t && t.wcId === wcId) {
      refreshZoomControl(t);
      // Briefly reveal the control after a change, then fade out. Hover/focus-within
      // CSS rules still win while the peek is active, so the control stays put if the
      // pointer is over the bar or a button holds focus.
      els.zoomControl.classList.add('zoom-control--peek');
      if (zoomPeekTimer) clearTimeout(zoomPeekTimer);
      zoomPeekTimer = setTimeout(() => {
        els.zoomControl.classList.remove('zoom-control--peek');
        zoomPeekTimer = null;
      }, ZOOM_PEEK_MS);
    }
  });

  // −/+/reset reuse the leg-1 zoom-apply IPC. Native button activation synthesizes a
  // click on Enter/Space, so these are keyboard-operable without a separate keydown
  // handler. All guarded by an active, non-internal tab with a live wcId.
  /** @param {'in'|'out'|'reset'} action */
  function applyTabZoom(action) {
    const t = activeTab();
    if (!t || isInternalTab(t) || t.wcId == null) return;
    window.goldfinch.zoomApply({ webContentsId: t.wcId, action });
  }
  els.zoomOut.addEventListener('click', () => applyTabZoom('out'));
  els.zoomIn.addEventListener('click', () => applyTabZoom('in'));
  els.zoomReset.addEventListener('click', () => applyTabZoom('reset'));

  /* ----------------------------------------------------------- find in page → overlay (SC4 / M05 F7) */
  // The find UI is a main-owned chrome-class WebContentsView (find-overlay.html) floating
  // over the full-bounds guest — NOT chrome DOM. openFind() drives it via findOverlayOpen;
  // typing/stepping/Esc/✕ live in the overlay page; per-tab findText/findOpen sync back
  // via the onFindOverlayText/onFindOverlayClosed subscriptions (see the onTab* block).

  /**
   * Open the overlay find bar for the given tab (or the current active tab if omitted).
   * Guards: no find on internal tabs, none when the lightbox is open. Main shows,
   * positions, seeds, and focuses the overlay (DD6) — the guest keeps full bounds (DD8).
   * @param {Tab|null} [tab]
   */
  function openFind(tab) {
    const t = tab || activeTab();
    if (!t || isInternalTab(t) || t.wcId == null) return;
    // Don't fight the lightbox (DD2 / AC6).
    if (!els.lightbox.classList.contains('hidden')) return;
    t.findOpen = true;
    window.goldfinch.findOverlayOpen({ wcId: t.wcId, findText: t.findText || '' });
  }

  // Main-side Ctrl+F capture → open find (page-focused path, DD2).
  window.goldfinch.onOpenFind(() => openFind());

  // Main-side Ctrl+J capture → open downloads (page-focused path, DD2). No active-internal
  // guard here: this only fires when a web page had focus, so the active tab is web by construction.
  window.goldfinch.onOpenDownloads(() => openDownloads());

  function dispatchSuggestion(id) {
    const match = /^sug:(\d+)$/.exec(id);
    const index = match ? Number(match[1]) : -1;
    const item = Number.isInteger(index) && index >= 0 ? suggest.items[index] : undefined;
    if (item && typeof item.url === 'string' && item.url) navigate(item.url);
    resetSuggestState();
  }

  function handleSuggestionsClosed(reason) {
    if (reason !== 'activated') resetSuggestState();
    else cancelSuggestTimers();
  }

  return {
    updateAddressChip,
    updateNavButtons,
    navigate,
    toUrl,
    closeSuggestions,
    resetSuggestionsForActivation,
    dispatchSuggestion,
    handleSuggestionsClosed,
    refreshZoomControl,
    refreshStar,
    applyTabZoom,
    openFind
  };
}
