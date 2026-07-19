const BLUR_REOPEN_SUPPRESS_MS = 300;

export function buildKebabModel() {
  return [
    { id: 'new-window', label: 'New window' },
    { id: 'settings', label: 'Settings' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'jars', label: 'Cookie jars' },
    { id: 'print', label: 'Print…' },
    { id: 'exit', label: 'Exit' }
  ];
}

export function chromePointToSheet(webviewsRect, x, y) {
  return {
    x: Math.round(x - webviewsRect.left),
    y: Math.max(0, Math.round(y - webviewsRect.top))
  };
}

export function rightSheetAnchor(webviewsRect, triggerRect) {
  return { alignRight: Math.round(triggerRect.right - webviewsRect.left), y: 0 };
}

export function leftSheetAnchor(webviewsRect, triggerRect) {
  return { alignLeft: Math.max(0, Math.round(triggerRect.left - webviewsRect.left)), y: 0 };
}

export function fixedTriggerMenu(trigger) {
  return {
    open: false,
    token: 0,
    blurClosedAt: -Infinity,
    ariaTarget: trigger,
    refocus(reason) {
      if (reason === 'escape' || reason === 'activated') trigger().focus();
    }
  };
}

export function createOverlayMenus({ bridge, states, now, onActivated, onClosed }) {
  let token = 0;

  function open(menuType, model, anchor, startIndex, options = {}) {
    const state = states[menuType];
    if (!state) return false;
    state.token = ++token;
    state.open = true;
    bridge.menuOverlayOpen({ menuType, model, anchor, startIndex, token: state.token, ...options });
    state.ariaTarget()?.setAttribute('aria-expanded', 'true');
    return true;
  }

  function close(reason) {
    bridge.menuOverlayClose({ reason });
  }

  function trigger(menuType, openMenu) {
    const state = states[menuType];
    if (!state) return;
    if (state.open) {
      close('toggle');
      return;
    }
    if (now() - state.blurClosedAt < BLUR_REOPEN_SUPPRESS_MS) return;
    openMenu();
  }

  bridge.onMenuOverlayActivated((payload) => {
    if (!payload || !states[payload.menuType] || typeof payload.id !== 'string') return;
    onActivated(payload);
  });

  bridge.onMenuOverlayClosed((payload) => {
    const { menuType, reason, token: closedToken } = payload || {};
    const state = states[menuType];
    if (!state || closedToken !== state.token) return;
    state.open = false;
    state.ariaTarget()?.setAttribute('aria-expanded', 'false');
    if (reason === 'blur') state.blurClosedAt = now();
    state.refocus(reason);
    onClosed(payload);
  });

  return { states, open, close, trigger };
}
