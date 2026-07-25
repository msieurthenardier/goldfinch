// @ts-check
'use strict';

/**
 * Build the event wiring shared by web and trusted-internal guest views. The
 * module owns no Electron state; owner lookups and every side effect are live
 * dependency reads so moved tabs automatically rebind to their new window.
 * @param {any} deps
 */
function createGuestWiring(deps) {
  const {
    registry,
    chromeForTab,
    crossViewNavAction,
    keydownToAction,
    isChromeActionForwardable,
    isRepeatSafeAction,
    isInternalPageUrl,
    isSafeTabUrl,
    toggleDevTools,
    applyZoom,
    isInternalContents,
    getHistoryRecorder,
    broadcastMoveTargetsChanged,
    faviconFetcher,
    logger
  } = deps;

  function handleCrossView(event, input, contents) {
    if (input.type !== 'keyDown') return false;
    const action = crossViewNavAction({
      key: input.key,
      control: input.control,
      meta: input.meta,
      shift: input.shift,
      alt: input.alt
    });
    if (!action) return false;
    event.preventDefault();
    if (input.isAutoRepeat) return true;
    const chrome = chromeForTab(contents.id);
    chrome?.focus();
    chrome?.send('chrome-shortcut-action', { action: 'focus-address' });
    return true;
  }

  function handleChromeShortcut(event, input, guestKind, contents) {
    if (input.type !== 'keyDown') return false;
    const action = keydownToAction({
      key: input.key,
      ctrl: input.control,
      meta: input.meta,
      shift: input.shift,
      alt: input.alt,
      lightboxOpen: false
    });
    if (!isChromeActionForwardable(action, guestKind)) return false;
    event.preventDefault();
    if (isRepeatSafeAction(action) || !input.isAutoRepeat) {
      chromeForTab(contents.id)?.send('chrome-shortcut-action', { action });
    }
    return true;
  }

  function wireGuestContents(contents) {
    // Mission 13 Flight 3 / Leg 3 (DD3, AC3): set the latch synchronously, before
    // any navigation can occur, so the app-lifecycle web-contents-created catch-all
    // (which cannot yet distinguish this guest from a chrome/overlay view at ITS
    // attach time — that fires during `new WebContentsView()`, before this function
    // runs) reads the latch INSIDE its own handler and early-returns for guests.
    // A future `await` inserted between `new WebContentsView()` and this call would
    // reopen the race the latch closes — keep this assignment first and synchronous.
    contents.__goldfinchNavGuarded = true;

    contents.setWindowOpenHandler(({ url }) => {
      const owner = registry.getWindowForGuest(contents.id);
      const openerPartition = owner ? owner.tabViews.get(contents.id)?.partition : undefined;
      chromeForTab(contents.id)?.send('open-tab', { url, openerPartition });
      return { action: 'deny' };
    });

    // Mission 13 Flight 3 / Leg 3 (DD3, AC1): session-aware predicate shared by
    // top-frame navigations, subframe navigations, and redirects. All three events
    // read `event.url` — `will-frame-navigate` passes a SINGLE merged Event (no
    // positional url arg); `will-navigate`/`will-redirect` also expose `event.url`
    // on the same event object. Reading a positional second argument here would
    // read `undefined` for will-frame-navigate and preventDefault on every subframe
    // navigation, breaking ordinary browsing.
    const guardNav = (event) => {
      if (contents.session?.__goldfinchInternal) {
        if (!isInternalPageUrl(event.url)) event.preventDefault();
      } else if (!isSafeTabUrl(event.url)) {
        event.preventDefault();
      }
    };
    contents.on('will-navigate', guardNav);
    contents.on('will-frame-navigate', guardNav);
    contents.on('will-redirect', guardNav);

    if (contents.session?.__goldfinchInternal) {
      contents.on('before-input-event', (event, input) => {
        if (handleCrossView(event, input, contents)) return;
        handleChromeShortcut(event, input, 'internal', contents);
      });
      return;
    }

    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (handleCrossView(event, input, contents)) return;
      if (handleChromeShortcut(event, input, 'web', contents)) return;

      if (input.key === 'F12') {
        if (!input.isAutoRepeat) toggleDevTools(contents);
        event.preventDefault();
        return;
      }
      if (!(input.control || input.meta)) return;

      let zoomAction = null;
      if (input.key === '=' || input.key === '+') zoomAction = 'in';
      else if (input.key === '-') zoomAction = 'out';
      else if (input.key === '0') zoomAction = 'reset';

      if (input.key === 'p' || input.key === 'P') {
        contents.print({}, (ok, reason) => {
          if (!ok) logger.warn('print failed:', reason);
        });
        event.preventDefault();
        return;
      }
      if (input.key === 'f' || input.key === 'F') {
        event.preventDefault();
        chromeForTab(contents.id)?.send('open-find');
        return;
      }
      if ((input.key === 'j' || input.key === 'J') && !input.isAutoRepeat) {
        event.preventDefault();
        chromeForTab(contents.id)?.send('open-downloads');
        return;
      }
      if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
        if (!input.isAutoRepeat) toggleDevTools(contents);
        event.preventDefault();
        return;
      }
      if (!zoomAction) return;
      applyZoom(contents, zoomAction);
      event.preventDefault();
    });

    const sendDevtoolsState = (open) => {
      chromeForTab(contents.id)?.send('devtools-state-changed', { wcId: contents.id, open });
    };
    contents.on('devtools-opened', () => sendDevtoolsState(true));
    contents.on('devtools-closed', () => sendDevtoolsState(false));
    contents.on('context-menu', (event, params) => {
      event.preventDefault();
      if (isInternalContents(contents)) return;
      chromeForTab(contents.id)?.send('page-context-menu', { wcId: contents.id, params });
    });
  }

  function wireTabViewEvents(view, wcId, partition) {
    const wc = view.webContents;
    const sendToChrome = (channel, payload) => chromeForTab(wcId)?.send(channel, payload);
    const guard = (fn) => (...args) => { if (!wc.isDestroyed()) fn(...args); };

    wc.on('did-navigate', guard(() => {
      sendToChrome('tab-did-navigate', { wcId, url: wc.getURL() });
      sendToChrome('tab-nav-state', { wcId, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
      getHistoryRecorder()?.handleNavigation({ wcId, partition, url: wc.getURL() });
    }));
    wc.on('did-navigate-in-page', guard(() => {
      sendToChrome('tab-did-navigate-in-page', { wcId, url: wc.getURL() });
      sendToChrome('tab-nav-state', { wcId, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
      getHistoryRecorder()?.handleNavigation({ wcId, partition, url: wc.getURL() });
    }));
    wc.on('page-title-updated', guard((_event, title) => {
      sendToChrome('tab-title', { wcId, title });
      getHistoryRecorder()?.handleTitleUpdated(wcId, title);
      if (registry.getWindowForGuest(wcId)?.activeTabWcId === wcId) broadcastMoveTargetsChanged();
    }));
    // Mission 13 Flight 1 / Leg 1 (DD1): favicons are fetched MAIN-SIDE in the
    // guest's own jar session (never the jar registry — burner partitions exist
    // only renderer-side) and delivered as a size-capped data: URL. Nothing
    // reaches the chrome on failure — no raw remote favicon URL is forwarded
    // any more. Fire-and-forget: guard() only proves wc was alive at EVENT
    // time; sendToChrome resolves the chrome at SEND time, so a tab closed
    // mid-fetch simply drops the send (forget(wcId) at teardown prevents the
    // per-tab sequence map from growing unbounded).
    wc.on('page-favicon-updated', guard((_event, favicons) => {
      faviconFetcher
        .request({ wcId, favicons, fetchImpl: (url) => wc.session.fetch(url) })
        .then((dataUrl) => {
          if (dataUrl) sendToChrome('tab-favicon', { wcId, favicons: [dataUrl] });
        })
        .catch(() => {});
    }));
    wc.on('did-start-loading', guard(() => {
      sendToChrome('tab-loading', { wcId, loading: true });
    }));
    wc.on('did-stop-loading', guard(() => {
      sendToChrome('tab-loading', { wcId, loading: false });
    }));
    wc.on('did-finish-load', guard(() => {
      sendToChrome('tab-did-finish-load', { wcId });
      sendToChrome('tab-nav-state', { wcId, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
    }));
    wc.on('dom-ready', guard(() => {
      sendToChrome('tab-dom-ready', { wcId, tabWcId: wcId });
    }));
    wc.on('found-in-page', guard((_event, result) => {
      const findOverlay = registry.getWindowForGuest(wcId)?.findOverlay;
      if (!findOverlay || !findOverlay.isSessionActive(wcId)) return;
      const overlayView = findOverlay.getView();
      if (!overlayView || overlayView.webContents.isDestroyed()) return;
      overlayView.webContents.send?.('find-overlay:count', {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches
      });
    }));
  }

  return { wireGuestContents, wireTabViewEvents };
}

module.exports = { createGuestWiring };
