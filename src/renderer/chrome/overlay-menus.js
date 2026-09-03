import { VAULT_BLUR_SURVIVAL_MENU_TYPES } from '../../shared/vault-blur-survival.js';

const BLUR_REOPEN_SUPPRESS_MS = 300;

export function buildKebabModel() {
  // Two separators group the menu into three bands: window-scoped (New window) /
  // internal-page destinations (Settings…Secrets) / app actions (Print, Exit).
  // The sheet renders `type:'separator'` as role="separator" (menu-overlay.js) and
  // the roving-tabindex/arrow-nav skips it for free (no role="menuitem"), the same
  // idiom the page-context menu uses.
  return [
    { id: 'new-window', label: 'New window' },
    { type: 'separator' },
    { id: 'settings', label: 'Settings' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'jars', label: 'Cookie jars' },
    { id: 'vault', label: 'Secrets' },
    { type: 'separator' },
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

// `measureSlot` (squawk 0057): optional — the chrome's #webviews slot-rect
// measurer (tab-controller.js's measureWebviewsSlotDIP, injected by
// renderer.js). When present, every open rides the current slot rect on the
// Ch1 payload as `slotBounds`, so main can place the sheet even when the
// active tab is a VIEWLESS welcome record: main's own bounds source is the
// active guest view, and a fresh-install window whose only tab is the welcome
// surface has never had one — the sheet stayed at its default zero bounds and
// every menu (kebab/container/site-info) opened invisible. Main prefers the
// live guest bounds and reads slotBounds only as the viewless fallback
// (register-overlay-ipc.js) — same chrome-measured-geometry authority as
// tabSetBounds/tabSetActive, no new trust surface.
export function createOverlayMenus({ bridge, states, now, onActivated, onClosed, measureSlot }) {
  let token = 0;

  function open(menuType, model, anchor, startIndex, options = {}) {
    const state = states[menuType];
    if (!state) return false;
    state.token = ++token;
    state.open = true;
    /** @type {any} */
    const payload = { menuType, model, anchor, startIndex, token: state.token, ...options };
    // M18 F3 L1 (DD8): the blur-survival flag, applied HERE — after the ...options spread,
    // and UNCONDITIONALLY (both true and false) — so no caller-supplied option can ever
    // override the shared allowlist's verdict in EITHER direction. This is the ONE funnel
    // every vault sheet open passes through (including the *ForAudit a11y duplicates in
    // vault-controller.js), so membership can never drift per call site.
    payload.survivesBlur = VAULT_BLUR_SURVIVAL_MENU_TYPES.has(menuType);
    if (measureSlot) payload.slotBounds = measureSlot(); // squawk 0057 — after the spread: measurement always wins
    bridge.menuOverlayOpen(payload);
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

/** Internal-page and site-info action bodies shared by overlay menu dispatch. */
export function createChromePageActions({
  window,
  tabs,
  createTab,
  activateTab,
  activeTab,
  isInternalTab,
  isInternalPageUrl,
  deriveSiteInfo,
  openNewTab
}) {
  function openDownloads() {
    createTab('goldfinch://downloads', null, { trusted: true });
  }

  function openJarsPage() {
    createTab('goldfinch://jars', null, { trusted: true });
  }

  function openVaultPage() {
    createTab('goldfinch://vault', null, { trusted: true });
  }

  function siteInfoInternalFlag(tab) {
    return !!tab && (isInternalTab(tab) || isInternalPageUrl(tab.url));
  }

  // isSettingsUrl (M16 F2 Leg 1, DD10): host-only match, fragment- and
  // path-blind ON PURPOSE — every path that creates or navigates the Settings
  // tab sets tab.url to 'goldfinch://settings/#privacy' (this function's own
  // createTab call below, the reuse branch's loadURL, and in-page hash
  // navigation), so a fragment-free/exact-match predicate would never match
  // an existing Settings tab and would create a duplicate tab on every call
  // (design review, high). Never any other internal tab (Downloads/Jars/
  // Vault/welcome) — the old `.find(isInternalTab)` predicate would grab any
  // of those.
  function isSettingsUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'goldfinch:' && parsed.host === 'settings';
    } catch {
      return false;
    }
  }

  function openSiteSettingsTab() {
    const existing = [...tabs.values()].find((t) => isInternalTab(t) && isSettingsUrl(t.url));
    if (existing && existing.wcId != null) {
      window.goldfinch.tabNavigate({ wcId: existing.wcId, verb: 'loadURL', args: ['goldfinch://settings/#privacy'] });
      activateTab(existing.id);
    } else if (existing) {
      activateTab(existing.id);
    } else {
      createTab('goldfinch://settings/#privacy', null, { trusted: true });
    }
  }

  function siteInfoModel(tab = activeTab()) {
    const info = deriveSiteInfo(tab, siteInfoInternalFlag(tab));
    if (info.internal === true) return [{ type: 'note', variant: 'secure', text: info.note }];
    return [
      { type: 'note', variant: 'host', text: info.host },
      { type: 'row', label: 'Connection', value: info.connection },
      { type: 'row', label: 'Trackers blocked', value: String(info.trackers) },
      { type: 'row', label: 'Permissions', value: String(info.permissions) },
      { type: 'action', id: 'site-settings', label: 'Site settings →' }
    ];
  }

  async function createContainerAndOpenTab(rawName) {
    const name = String(rawName == null ? '' : rawName).trim();
    if (!name) return;
    const container = await window.goldfinch.newContainerCreate(name);
    if (container) openNewTab(container); // M16 F2 Leg 1 (DD4)
  }

  return { openDownloads, openJarsPage, openVaultPage, openSiteSettingsTab, siteInfoModel, createContainerAndOpenTab };
}
