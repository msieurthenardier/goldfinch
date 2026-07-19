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
    contents.setWindowOpenHandler(({ url }) => {
      const owner = registry.getWindowForGuest(contents.id);
      const openerPartition = owner ? owner.tabViews.get(contents.id)?.partition : undefined;
      chromeForTab(contents.id)?.send('open-tab', { url, openerPartition });
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
      if (contents.session?.__goldfinchInternal) {
        if (!isInternalPageUrl(url)) event.preventDefault();
      } else if (!isSafeTabUrl(url)) {
        event.preventDefault();
      }
    });

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
      sendToChrome('tab-nav-state', { wcId, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
      getHistoryRecorder()?.handleNavigation({ wcId, partition, url: wc.getURL() });
    }));
    wc.on('did-navigate-in-page', guard(() => {
      sendToChrome('tab-did-navigate-in-page', { wcId, url: wc.getURL() });
      sendToChrome('tab-nav-state', { wcId, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
      getHistoryRecorder()?.handleNavigation({ wcId, partition, url: wc.getURL() });
    }));
    wc.on('page-title-updated', guard((_event, title) => {
      sendToChrome('tab-title', { wcId, title });
      getHistoryRecorder()?.handleTitleUpdated(wcId, title);
      if (registry.getWindowForGuest(wcId)?.activeTabWcId === wcId) broadcastMoveTargetsChanged();
    }));
    wc.on('page-favicon-updated', guard((_event, favicons) => {
      sendToChrome('tab-favicon', { wcId, favicons });
    }));
    wc.on('did-start-loading', guard(() => {
      sendToChrome('tab-loading', { wcId, loading: true });
    }));
    wc.on('did-stop-loading', guard(() => {
      sendToChrome('tab-loading', { wcId, loading: false });
    }));
    wc.on('did-finish-load', guard(() => {
      sendToChrome('tab-did-finish-load', { wcId });
      sendToChrome('tab-nav-state', { wcId, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
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
