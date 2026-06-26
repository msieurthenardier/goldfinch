'use strict';

/* Goldfinch browser UI controller: tabs, navigation, and the media panel. */

const HOMEPAGE = 'https://www.google.com';
let homePageCache = HOMEPAGE;
function currentHomePage() { return homePageCache || HOMEPAGE; }

const els = {
  tabstrip: /** @type {HTMLElement} */ (document.getElementById('tabstrip')),
  tabs: /** @type {HTMLElement} */ (document.getElementById('tabs')),
  newTab: /** @type {HTMLButtonElement} */ (document.getElementById('new-tab')),
  newTabMenu: /** @type {HTMLButtonElement} */ (document.getElementById('new-tab-menu')),
  winMin: /** @type {HTMLButtonElement} */ (document.getElementById('win-min')),
  winMax: /** @type {HTMLButtonElement} */ (document.getElementById('win-max')),
  winClose: /** @type {HTMLButtonElement} */ (document.getElementById('win-close')),
  containerMenu: /** @type {HTMLElement} */ (document.getElementById('container-menu')),
  webviews: /** @type {HTMLElement} */ (document.getElementById('webviews')),
  back: /** @type {HTMLButtonElement} */ (document.getElementById('back')),
  forward: /** @type {HTMLButtonElement} */ (document.getElementById('forward')),
  reload: /** @type {HTMLButtonElement} */ (document.getElementById('reload')),
  address: /** @type {HTMLInputElement} */ (document.getElementById('address')),
  toggleMedia: /** @type {HTMLButtonElement} */ (document.getElementById('toggle-media')),
  mediaCount: /** @type {HTMLElement} */ (document.getElementById('media-count')),
  panel: /** @type {HTMLElement} */ (document.getElementById('media-panel')),
  mediaList: /** @type {HTMLElement} */ (document.getElementById('media-list')),
  mediaEmpty: /** @type {HTMLElement} */ (document.getElementById('media-empty')),
  mediaStatus: /** @type {HTMLElement} */ (document.getElementById('media-status')),
  mediaClose: /** @type {HTMLButtonElement} */ (document.getElementById('media-close')),
  mediaRescan: /** @type {HTMLButtonElement} */ (document.getElementById('media-rescan')),
  mediaDownloadSelected: /** @type {HTMLButtonElement} */ (document.getElementById('media-download-selected')),
  filters: /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.filter')),
  toasts: /** @type {HTMLElement} */ (document.getElementById('toasts')),
  lightbox: /** @type {HTMLElement} */ (document.getElementById('lightbox')),
  lightboxStage: /** @type {HTMLElement} */ (document.getElementById('lightbox-stage')),
  lightboxCaption: /** @type {HTMLElement} */ (document.getElementById('lightbox-caption')),
  lightboxZoomLevel: /** @type {HTMLElement} */ (document.getElementById('lightbox-zoom-level')),
  lightboxClose: /** @type {HTMLButtonElement} */ (document.getElementById('lightbox-close')),
  lightboxZoomIn: /** @type {HTMLButtonElement} */ (document.getElementById('lightbox-zoom-in')),
  lightboxZoomOut: /** @type {HTMLButtonElement} */ (document.getElementById('lightbox-zoom-out')),
  lightboxZoomReset: /** @type {HTMLButtonElement} */ (document.getElementById('lightbox-zoom-reset')),
  togglePrivacy: /** @type {HTMLButtonElement} */ (document.getElementById('toggle-privacy')),
  toggleDevtools: /** @type {HTMLButtonElement} */ (document.getElementById('toggle-devtools')),
  privacyCount: /** @type {HTMLElement} */ (document.getElementById('privacy-count')),
  privacyPanel: /** @type {HTMLElement} */ (document.getElementById('privacy-panel')),
  privacyBody: /** @type {HTMLElement} */ (document.getElementById('privacy-body')),
  privacyClose: /** @type {HTMLButtonElement} */ (document.getElementById('privacy-close')),
  privacyRefresh: /** @type {HTMLButtonElement} */ (document.getElementById('privacy-refresh')),
  player: /** @type {HTMLElement} */ (document.getElementById('player')),
  playerAudio: /** @type {HTMLAudioElement} */ (document.getElementById('player-audio')),
  playerTitle: /** @type {HTMLElement} */ (document.getElementById('player-title')),
  playerProgress: /** @type {HTMLElement} */ (document.getElementById('player-progress')),
  playerSeek: /** @type {HTMLElement} */ (document.getElementById('player-seek')),
  playerCur: /** @type {HTMLElement} */ (document.getElementById('player-cur')),
  playerDur: /** @type {HTMLElement} */ (document.getElementById('player-dur')),
  playerPlay: /** @type {HTMLButtonElement} */ (document.getElementById('player-play')),
  playerPrev: /** @type {HTMLButtonElement} */ (document.getElementById('player-prev')),
  playerNext: /** @type {HTMLButtonElement} */ (document.getElementById('player-next')),
  kebab: /** @type {HTMLButtonElement} */ (document.getElementById('kebab')),
  kebabMenu: /** @type {HTMLElement} */ (document.getElementById('kebab-menu')),
  addressChip: /** @type {HTMLButtonElement} */ (document.getElementById('address-chip')),
  siteInfoPopup: /** @type {HTMLElement} */ (document.getElementById('site-info-popup')),
  pageContextMenu: /** @type {HTMLElement} */ (document.getElementById('page-context-menu')),
  automationIndicator: /** @type {HTMLButtonElement} */ (document.getElementById('automation-indicator')),
  automationIndicatorBadge: /** @type {HTMLElement} */ (document.getElementById('automation-indicator-badge')),
  zoomControl: /** @type {HTMLElement} */ (document.getElementById('zoom-control')),
  zoomOut: /** @type {HTMLButtonElement} */ (document.getElementById('zoom-out')),
  zoomIn: /** @type {HTMLButtonElement} */ (document.getElementById('zoom-in')),
  zoomReset: /** @type {HTMLButtonElement} */ (document.getElementById('zoom-reset')),
  zoomPercent: /** @type {HTMLElement} */ (document.getElementById('zoom-percent')),
  // Find bar (SC4/DD1)
  findBar: /** @type {HTMLElement} */ (document.getElementById('find-bar')),
  findInput: /** @type {HTMLInputElement} */ (document.getElementById('find-input')),
  findCount: /** @type {HTMLElement} */ (document.getElementById('find-count')),
  findPrev: /** @type {HTMLButtonElement} */ (document.getElementById('find-prev')),
  findNext: /** @type {HTMLButtonElement} */ (document.getElementById('find-next')),
  findClose: /** @type {HTMLButtonElement} */ (document.getElementById('find-close'))
};

// Tag <html> with the OS platform so window-chrome CSS can branch (mac native
// traffic lights vs. win/linux custom controls). Optional-chained so a non-preload
// load path never aborts init at the top level.
document.documentElement.classList.add(`platform-${window.goldfinch?.platform ?? 'unknown'}`);

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

/** @type {Map<string, Tab>} */
const tabs = new Map();
let activeTabId = null;
let activeFilter = 'all';
let tabSeq = 0;
// Track the last visible web tab wcId so we can hide it when switching to an internal tab.
let visibleWebTabWcId = null;
// RAF pending flag for debounced geometry sends.
let rafGeometryPending = false;
// Whether a freeze-frame is currently active (guest hidden, still image shown in #webviews background).
let guestFrozen = false;

/* ----------------------------------------------------- jars / containers */

const DEFAULT_CONTAINER = { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' };
let containers = [DEFAULT_CONTAINER];
window.goldfinch.jarsList().then((list) => {
  if (list && list.length) containers = list;
  // The activity snapshot may have arrived before the jars list resolved, in which
  // case a jar session's indicator title showed the raw jarId. Re-run with the cached
  // snapshot now that `containers` is populated, so the friendly jar name is used.
  updateAutomationIndicator(lastSnap);
});

/* ------------------------------------------------------- kebab (overflow) menu */
// APG menu-button: role="menu" popup with four static role="menuitem" items
// (Settings, Downloads, Print…, Exit) + roving tabindex + arrow-nav. Open/close/dismissal/
// mutual-exclusion and the APG keyboard contract are owned by the shared menuController.

/** @returns {HTMLElement[]} */
function kebabItems() {
  return /** @type {HTMLElement[]} */ ([...els.kebabMenu.querySelectorAll('[role="menuitem"]')]);
}
function positionKebabMenu() {
  const r = els.kebab.getBoundingClientRect();
  els.kebabMenu.style.top = r.bottom + 4 + 'px';
  els.kebabMenu.style.right = window.innerWidth - r.right + 'px';
  els.kebabMenu.style.left = 'auto';
}
// Kebab registered with the controller. `onOpen(startIndex)` is the raw show body;
// `onClose` is the raw hide body. The public `closeKebabMenu` below is DISTINCT.
const kebabEntry = menuController.register({
  trigger: els.kebab,
  menu: els.kebabMenu,
  items: kebabItems,
  /** @param {number} [startIndex] index to focus on open (default 0; -1 = last item) */
  onOpen(startIndex = 0) {
    els.kebabMenu.classList.remove('hidden');
    positionKebabMenu();
    els.kebab.setAttribute('aria-expanded', 'true');
    const items = kebabItems();
    focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
    // Freeze-frame: capture the guest and apply the still while the menu is up.
    // Fire-and-forget (async); the menu is already visible; the freeze arrives when capture resolves.
    freezeGuest(() => !els.kebabMenu.classList.contains('hidden'));
  },
  onClose() {
    els.kebabMenu.classList.add('hidden');
    els.kebab.setAttribute('aria-expanded', 'false');
    unfreezeGuest();
  }
});
// Thin public wrapper — delegates to the controller. DISTINCT from onClose above.
function closeKebabMenu() {
  menuController.close(kebabEntry);
}

// Activation: native click on the focused <button> menuitem fires these.
els.kebabMenu.querySelector('#kebab-settings')?.addEventListener('click', () => {
  closeKebabMenu();
  createTab('goldfinch://settings', null, { trusted: true });
});
els.kebabMenu.querySelector('#kebab-downloads')?.addEventListener('click', () => {
  closeKebabMenu();
  openDownloads();
});
els.kebabMenu.querySelector('#kebab-print')?.addEventListener('click', () => {
  closeKebabMenu();
  const t = activeTab();
  if (t && !isInternalTab(t) && t.wcId != null) window.goldfinch.print({ webContentsId: t.wcId });
});
els.kebabMenu.querySelector('#kebab-exit')?.addEventListener('click', () => {
  closeKebabMenu();
  window.goldfinch.appQuit();
});

els.kebab.addEventListener('click', () => {
  if (menuController.current === kebabEntry) menuController.close(kebabEntry);
  else menuController.open(kebabEntry, 0);
});

/* ------------------------------------------------------- container picker */
// APG menu-button: role="menu" popup built per-open from the `containers` array.
// Open/close/dismissal/mutual-exclusion and APG keyboard contract: shared menuController.

// Shared open path for downloads (DD2): kebab downloads item + both Ctrl+J paths converge here.
function openDownloads() {
  createTab('goldfinch://downloads', null, { trusted: true });
}

/** @returns {HTMLElement[]} */
function containerItems() {
  return /** @type {HTMLElement[]} */ ([...els.containerMenu.querySelectorAll('[role="menuitem"]')]);
}
// Container picker registered with the controller.
const containerEntry = menuController.register({
  trigger: els.newTabMenu,
  menu: els.containerMenu,
  items: containerItems,
  /** @param {number} [startIndex] index to focus on open (default 0; -1 = last item) */
  onOpen(startIndex = 0) {
    const m = els.containerMenu;
    // role="presentation" on the non-item header so role="menu" doesn't trip
    // axe aria-required-children (only .cm-item buttons are role="menuitem").
    m.innerHTML = '<div class="cm-title" role="presentation">Open new tab in…</div>';
    for (const c of containers) {
      const item = document.createElement('button');
      item.className = 'cm-item';
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `<span class="cm-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}`;
      item.addEventListener('click', () => {
        closeContainerMenu();
        createTab(currentHomePage(), c);
      });
      m.appendChild(item);
    }
    const burner = document.createElement('button');
    burner.className = 'cm-item';
    burner.setAttribute('role', 'menuitem');
    burner.innerHTML = '<span class="cm-dot" style="background:#ff8c42"></span>Burner tab <em>(evaporates)</em>';
    burner.addEventListener('click', () => {
      closeContainerMenu();
      createTab(currentHomePage(), makeBurner());
    });
    m.appendChild(burner);

    const add = document.createElement('button');
    add.className = 'cm-item add';
    add.setAttribute('role', 'menuitem');
    add.textContent = '+ New container…';
    add.addEventListener('click', () => {
      closeContainerMenu();
      document.getElementById('new-container-dialog').classList.remove('hidden');
      document.getElementById('new-container-name').focus();
    });
    m.appendChild(add);
    m.classList.remove('hidden');
    // Anchor the menu under the pill's ▾ trigger.
    m.style.left = els.newTabMenu.getBoundingClientRect().left + 'px';
    els.newTabMenu.setAttribute('aria-expanded', 'true');
    // Apply roving tabindex + focus via the shared helper (items rebuilt every open).
    const items = containerItems();
    focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
    // Freeze-frame: capture the guest and apply the still while the menu is up.
    // Fire-and-forget (async); the menu is already visible; the freeze arrives when capture resolves.
    freezeGuest(() => !els.containerMenu.classList.contains('hidden'));
  },
  onClose() {
    els.containerMenu.classList.add('hidden');
    els.newTabMenu.setAttribute('aria-expanded', 'false');
    unfreezeGuest();
  }
});
// Thin public wrapper — delegates to the controller. DISTINCT from onClose above.
function closeContainerMenu() {
  menuController.close(containerEntry);
}

function makeBurner() {
  const n = Math.floor(Math.random() * 1e9);
  return { id: `burner-${n}`, name: 'Burner', color: '#ff8c42', partition: `burner:${n}`, burner: true };
}

/* ------------------------------------------------------- site-info popup */
// Registered with menuController WITHOUT an items getter — the controller's roving
// keydown early-returns on !entry.items, so it no-ops for this popup. The popup
// supplies its own keydown (Escape + Tab → close + return focus to chip). DD5/DD7.

function positionSiteInfoPopup() {
  const r = els.addressChip.getBoundingClientRect();
  els.siteInfoPopup.style.top = r.bottom + 4 + 'px';
  els.siteInfoPopup.style.left = r.left + 'px';
  els.siteInfoPopup.style.right = 'auto';
}

/** @param {Tab|null} tab */
function buildSiteInfo(tab) {
  const popup = els.siteInfoPopup;
  if (!tab || isInternalTab(tab) || isInternalPageUrl(tab.url)) {
    // Internal tab — static secure-page note; no site data, no "Site settings" link.
    popup.innerHTML =
      '<div class="si-section">' +
      '<div class="si-row si-secure">You\'re viewing a secure Goldfinch page.</div>' +
      '</div>';
    return;
  }

  // Web tab — build origin/connection/privacy summary.
  let host;
  try {
    host = new URL(tab.url).host;
  } catch {
    host = '—';
  }
  const connection = /^https:/i.test(tab.url || '') ? 'HTTPS' : 'HTTP';
  const trackers = tab.privacy?.net?.trackers?.blocked ?? 0;
  const permissions = tab.privacy?.permissions?.length ?? 0;

  popup.innerHTML =
    '<div class="si-section">' +
    '<div class="si-row si-host">' + escapeHtml(host) + '</div>' +
    '<div class="si-row"><span class="si-label">Connection</span><span class="si-value">' + escapeHtml(connection) + '</span></div>' +
    '<div class="si-row"><span class="si-label">Trackers blocked</span><span class="si-value">' + escapeHtml(String(trackers)) + '</span></div>' +
    '<div class="si-row"><span class="si-label">Permissions</span><span class="si-value">' + escapeHtml(String(permissions)) + '</span></div>' +
    '</div>' +
    '<div class="si-actions">' +
    '<button class="text-btn small si-settings-btn">Site settings →</button>' +
    '</div>';

  const settingsBtn = /** @type {HTMLButtonElement|null} */ (popup.querySelector('.si-settings-btn'));
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      closeSiteInfo();
      const existing = [...tabs.values()].find(isInternalTab);
      if (existing && existing.wcId != null) {
        // Internal tab is now a WebContentsView (Leg 3); navigate via tab-navigate IPC.
        window.goldfinch.tabNavigate({ wcId: existing.wcId, verb: 'loadURL', args: ['goldfinch://settings/#privacy'] });
        activateTab(existing.id);
      } else if (existing) {
        // wcId not yet arrived; just activate the tab (it will load at its original URL).
        activateTab(existing.id);
      } else {
        createTab('goldfinch://settings/#privacy', null, { trusted: true });
      }
    });
  }
}

const siteInfoEntry = menuController.register({
  trigger: els.addressChip,
  menu: els.siteInfoPopup,
  onOpen() {
    buildSiteInfo(activeTab());
    els.siteInfoPopup.classList.remove('hidden');
    positionSiteInfoPopup();
    // Focus the "Site settings →" button if present (web state), else the container (internal).
    const btn = /** @type {HTMLElement|null} */ (els.siteInfoPopup.querySelector('button, a'));
    (btn || els.siteInfoPopup).focus();
    // Freeze-frame: delegate to the shared helper (guestFrozen flag + #webviews background).
    // Pass a liveness check so a rapid open+close doesn't apply a stale freeze.
    freezeGuest(() => !els.siteInfoPopup.classList.contains('hidden'));
    // No sendActiveBounds() — site-info uses freeze-frame; guest is hidden while open.
  },
  onClose() {
    els.siteInfoPopup.classList.add('hidden');
    unfreezeGuest();
    // No sendActiveBounds() needed — unfreezeGuest calls tabSetActive directly.
  }
});

// Thin public wrapper — delegates to the controller. Distinct from onClose above.
function closeSiteInfo() {
  menuController.close(siteInfoEntry);
}

// Chip click: toggle the popup (mirrors the kebab click pattern).
// This is the click handler leg 4 intentionally left off.
els.addressChip.addEventListener('click', () => {
  if (menuController.current === siteInfoEntry) menuController.close(siteInfoEntry);
  else menuController.open(siteInfoEntry);
});

// Popup keydown: Escape or Tab → close + return focus to chip.
// IMPORTANT: the controller's menu-keydown early-returns on !entry.items, so it will NOT
// handle Escape/Tab for this popup — this listener is the ONLY thing that does it.
els.siteInfoPopup.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    closeSiteInfo();
    els.addressChip.focus();
  }
});

/* ------------------------------------------------- page context menu (SC6/DD2/DD3) */
// The custom web-content context menu, rendered via the menuController. It subscribes to
// onPageContextMenu IPC ({ wcId, params, dataURL? }) forwarded from the guest's main-side
// context-menu listener (internal goldfinch:// guests auto-excluded main-side, DD6).
// Items are built per-invocation from the forwarded params; the menu opens at the cursor
// position and supplies focus-return via the additive focusReturn? option.

/** @returns {HTMLElement[]} */
function pageContextItems() {
  return /** @type {HTMLElement[]} */ ([...els.pageContextMenu.querySelectorAll('[role="menuitem"]')]);
}

// Module-scoped state: the LAST forwarded { wcId, params }, the cursor coords to open at,
// and the focus-return target captured at open. Acted-on wcId is the one captured at
// right-click (TOCTOU — never re-resolved via activeTab() for dispatch). `keyboard` marks a
// chrome-focused Shift+F10/ContextMenu invocation so focus-return branches correctly.
/** @type {{ wcId: number|null, params: any, x: number, y: number, returnFocus: HTMLElement|null, keyboard: boolean, toolbarItem: ('media'|'shields'|'devtools'|null) }} */
const pageCtx = { wcId: null, params: null, x: 0, y: 0, returnFocus: null, keyboard: false,
  toolbarItem: null };  // 'media' | 'shields' | 'devtools' | null  (null = page-content mode)

/** Truncate a string for an inline menu label. */
function truncateLabel(s, n = 40) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Derive a download filename from a media URL's basename (mirrors media-panel naming). */
function basenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || u.hostname || 'image';
  } catch {
    return 'image';
  }
}

/**
 * Build the context-appropriate sections from the captured params into the (empty) menu node.
 * In toolbar-mode (ctx.toolbarItem set) it short-circuits to a single "Unpin {item}" item.
 * @param {{ wcId: number|null, params: any, toolbarItem?: ('media'|'shields'|'devtools'|null) }} ctx
 */
function buildPageContextSections(ctx) {
  const m = els.pageContextMenu;
  m.innerHTML = '';
  const p = ctx.params || {};
  let needSep = false;

  /** Append a thin separator before the next section (skipped before the first). */
  const sep = () => {
    if (!needSep) return;
    const s = document.createElement('div');
    s.className = 'cm-sep';
    s.setAttribute('role', 'separator');
    m.appendChild(s);
  };
  /**
   * @param {string} label  visible text (already plain — set via textContent, no HTML injection)
   * @param {() => void} onClick  action; every handler closes the menu first so focus-return runs
   */
  const item = (label, onClick) => {
    const b = document.createElement('button');
    b.className = 'cm-item';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.addEventListener('click', () => {
      closePageContextMenu();
      onClick();
    });
    m.appendChild(b);
    needSep = true;
  };

  // --- toolbar-mode: single "Unpin {item}" item — short-circuit; no page sections. ---
  if (ctx.toolbarItem) {
    const itm = ctx.toolbarItem;
    const label = 'Unpin ' + (itm === 'media' ? 'Media'
      : itm === 'shields' ? 'Shields' : 'DevTools');
    item(label, () => {
      window.goldfinch.unpinToolbarItem(itm);
      els.address.focus();
    });
    return;
  }

  // --- link ---
  if (p.linkURL) {
    sep();
    item('Open link in new tab', () => createTab(p.linkURL));
    item('Copy link', () => window.goldfinch.clipboardWriteText(p.linkURL));
  }

  // --- image (prefer srcURL, fall back to imageURL) ---
  const imgSrc = p.mediaType === 'image' ? (p.srcURL || p.imageURL) : null;
  if (imgSrc) {
    sep();
    item('Open image in new tab', () => createTab(imgSrc));
    item('Copy image address', () => window.goldfinch.clipboardWriteText(imgSrc));
    item('Save image', () => {
      const r = window.goldfinch.downloadMedia({
        webContentsId: ctx.wcId,
        url: imgSrc,
        suggestedName: basenameFromUrl(imgSrc)
      });
      Promise.resolve(r).then((res) => {
        if (!res || !res.ok) toast('Download failed', (res && res.error) || 'Unknown error');
      }).catch(() => toast('Download failed', 'Unknown error'));
    });
  }

  // --- selection ---
  if (p.selectionText) {
    sep();
    item('Copy', () => window.goldfinch.clipboardWriteText(p.selectionText));
    item(`Search for "${truncateLabel(p.selectionText, 30)}"`, () => createTab(toUrl(p.selectionText)));
  }

  // --- editable (edit-actions gated by editFlags; render only if truthy — OMIT otherwise) ---
  if (p.isEditable) {
    const f = p.editFlags || {};
    const acts = [];
    if (f.canCut) acts.push(['Cut', 'cut']);
    if (f.canCopy) acts.push(['Copy', 'copy']);
    if (f.canPaste) acts.push(['Paste', 'paste']);
    if (f.canUndo) acts.push(['Undo', 'undo']);
    if (f.canRedo) acts.push(['Redo', 'redo']);
    if (acts.length) {
      sep();
      for (const [label, action] of acts) {
        item(label, () => window.goldfinch.pageContextAction({ webContentsId: ctx.wcId, action }));
      }
    }
  }

  // --- spelling suggestions ---
  if (p.misspelledWord) {
    sep();
    const sugg = Array.isArray(p.dictionarySuggestions) ? p.dictionarySuggestions.slice(0, 8) : [];
    if (sugg.length) {
      for (const word of sugg) {
        item(word, () => window.goldfinch.correctMisspelling({ webContentsId: ctx.wcId, word }));
      }
    } else {
      // Informational placeholder (the only disabled affordance — not in the roving set).
      const none = document.createElement('div');
      none.className = 'cm-item';
      none.setAttribute('aria-disabled', 'true');
      none.textContent = 'No suggestions';
      m.appendChild(none);
      needSep = true;
    }
  }

  // --- always: Inspect (routes through toggle-devtools; web-only by construction, DD6) ---
  sep();
  item('Inspect', () => window.goldfinch.toggleDevtools({ webContentsId: ctx.wcId }));
}

/**
 * Position the menu at the cursor. params.x/y are GUEST-page coords relative to the
 * active WebContentsView's top-left; map to chrome-overlay client coords via the
 * #webviews slot getBoundingClientRect(), then clamp inside the viewport. For a
 * chrome-focused keyboard invocation, x/y are already chrome client coords
 * (keyboard = true skips the guest-view offset).
 */
function positionPageContextMenu(px, py, keyboard) {
  // params.x/y are GUEST-VIEW-relative (relative to the content region's top-left). Offset
  // by the #webviews slot rect to map to chrome client coords. All tabs are now native
  // WebContentsViews (Leg 3 — no <webview> elements remain), so the #webviews rect is always
  // the correct origin. Keyboard (chrome-focused Shift+F10) coords are already chrome client
  // coords → no offset needed.
  let r;
  if (keyboard) {
    r = { left: 0, top: 0 };
  } else {
    r = els.webviews.getBoundingClientRect();
  }
  const m = els.pageContextMenu;
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  let x = r.left + px;
  let y = r.top + py;
  x = Math.min(x, window.innerWidth - mw - 4);
  y = Math.min(y, window.innerHeight - mh - 4);
  m.style.left = Math.max(4, x) + 'px';
  m.style.top = Math.max(4, y) + 'px';
  m.style.right = 'auto';
}

const pageContextEntry = menuController.register({
  // No persistent trigger button — the menu node is its own `trigger` purely so the
  // controller's trigger-keydown wiring has a target. Focus-return goes through focusReturn.
  trigger: els.pageContextMenu,
  menu: els.pageContextMenu,
  items: pageContextItems,
  /** @param {number} [startIndex] index to focus on open (default 0; -1 = last) */
  onOpen(startIndex = 0) {
    // Freeze whenever a web guest could occlude the menu (freezeGuest self-gates to web tabs —
    // it no-ops for internal/no-guest). Toolbar-Unpin and keyboard (Shift+F10) invocations also
    // overlap the guest region when no side panel is open (the Unpin dropdown extends DOWN into
    // the content area), so they must freeze too — excluding them left the menu occluded by the
    // opaque native guest. Fire-and-forget via the shared helper, the proven kebab/container path;
    // the liveness check bails if the menu was dismissed before the async capture resolves.
    // (Positioning is unaffected — positionPageContextMenu still uses pageCtx.keyboard for the
    // offset; freeze only hides the guest + paints the still. onClose unfreezes unconditionally.)
    freezeGuest(() => menuController.current === pageContextEntry);
    buildPageContextSections(pageCtx);
    els.pageContextMenu.classList.remove('hidden');
    // Self-focus the chrome menu node (blur-race defensive mitigation).
    els.pageContextMenu.focus();
    positionPageContextMenu(pageCtx.x, pageCtx.y, pageCtx.keyboard);
    const items = pageContextItems();
    if (items.length) focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
  },
  onClose() {
    els.pageContextMenu.classList.add('hidden');
    unfreezeGuest();
    const ret = pageCtx.returnFocus;
    pageCtx.returnFocus = null;
    if (ret && typeof ret.focus === 'function') ret.focus();
  },
  focusReturn() {
    const ret = pageCtx.returnFocus;
    pageCtx.returnFocus = null;
    // All tabs are native WebContentsViews (Leg 3); there is no <webview> element to focus.
    // For mouse right-click on a guest, Electron naturally returns focus to the guest view
    // on menu close; the chrome address bar is the fallback for the keyboard / toolbar-Unpin cases.
    if (ret && ret !== document.body && typeof ret.focus === 'function') { ret.focus(); return; }
    els.address.focus();
  }
});
// Thin public wrapper — delegates to the controller. DISTINCT from onClose above.
function closePageContextMenu() {
  menuController.close(pageContextEntry);
}

// Subscription: the guest right-click flows guest -> main -> this IPC ({ wcId, params }).
// Store state + coords + focus-return, then open. The freeze-frame is applied in
// pageContextEntry.onOpen via the shared freezeGuest() helper (Option A — the proven
// kebab/container path), NOT from an event-time main-side capture (unreliable on WSLg).
// The open is deferred to a microtask so any chrome `window` blur from the right-click has settled.
window.goldfinch.onPageContextMenu(({ wcId, params }) => {
  pageCtx.wcId = wcId;
  pageCtx.params = params;
  pageCtx.x = (params && typeof params.x === 'number') ? params.x : 0;
  pageCtx.y = (params && typeof params.y === 'number') ? params.y : 0;
  pageCtx.keyboard = false;
  pageCtx.toolbarItem = null;
  pageCtx.returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  queueMicrotask(() => menuController.open(pageContextEntry, 0));
});

// Shift+F10 / ContextMenu key — chrome-focused case. When focus is INSIDE the guest
// <webview>, Chromium synthesizes a real context-menu event on the guest webContents,
// which flows through main's listener and the onPageContextMenu subscription above.
// This handler only covers the CHROME-focused case (toolbar/chrome element focus).
document.addEventListener('keydown', (e) => {
  const isContextKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
  if (!isContextKey) return;
  if (!els.lightbox.classList.contains('hidden')) return;
  const target = /** @type {HTMLElement|null} */ (document.activeElement);
  if (!target || target === document.body) return;
  // Gate: toolbar pin buttons fire both contextmenu AND this keydown — the contextmenu
  // listener already opens the toolbar Unpin menu; return early here to avoid double-firing.
  if (target === els.toggleMedia || target === els.togglePrivacy || target === els.toggleDevtools) return;
  e.preventDefault();
  const r = target.getBoundingClientRect();
  pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
  pageCtx.params = null;
  pageCtx.x = Math.round(r.left);
  pageCtx.y = Math.round(r.bottom);
  pageCtx.keyboard = true;
  pageCtx.toolbarItem = null;
  pageCtx.returnFocus = target;
  menuController.open(pageContextEntry, 0);
});

/**
 * Toolbar-mode invocation: right-click a pinned toolbar icon to get a single "Unpin {item}"
 * item, anchored at the clicked button. Reuses pageContextEntry for positioning + keyboard nav.
 * @param {'media'|'shields'|'devtools'} item
 * @param {HTMLElement} anchorEl  the toolbar button that was right-clicked
 */
function openToolbarContextMenu(item, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  pageCtx.toolbarItem = item;
  pageCtx.params = null;
  pageCtx.wcId = null;
  pageCtx.x = Math.round(r.left);
  pageCtx.y = Math.round(r.bottom);
  pageCtx.keyboard = true;
  pageCtx.returnFocus = anchorEl;
  menuController.open(pageContextEntry, 0);
}

/**
 * Test/audit hook: open the page context menu with a representative synthetic params payload
 * so the `npm run a11y` harness can audit the open #page-context-menu. Builds a full-section
 * menu (link + selection + editable + spelling-suggestions + Inspect) at a fixed chrome coord.
 * Reachable via the MCP evaluate tool (top-level function → window global).
 */
// eslint-disable-next-line no-unused-vars
function openPageContextMenuForAudit() {
  pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
  pageCtx.params = {
    linkURL: 'https://example.com/',
    selectionText: 'sample',
    isEditable: true,
    editFlags: { canCut: true, canCopy: true, canPaste: true, canUndo: true, canRedo: true },
    misspelledWord: 'teh',
    dictionarySuggestions: ['the', 'ten', 'tea'],
    x: 80,
    y: 80
  };
  pageCtx.x = 80;
  pageCtx.y = 80;
  pageCtx.keyboard = true;
  pageCtx.toolbarItem = null;
  pageCtx.returnFocus = els.address;
  menuController.open(pageContextEntry, 0);
}

/* ------------------------------------------------------------------ tabs */

function createTab(url = currentHomePage(), container = null, { trusted = false } = {}) {
  // Provenance is the CALL SITE, never the URL: trusted is an explicit caller arg.
  // The untrusted branch validates with isSafeTabUrl (which rejects `goldfinch://`),
  // so web content reaching here via onOpenTab can never select the internal branch.
  const ok = trusted ? isInternalPageUrl(url) : isSafeTabUrl(url);
  if (!ok) return null;
  const id = `tab-${++tabSeq}`;
  // ⚠️ DATA-LOSS TRAP: the synthetic internal jar is set as the `jar` ITSELF — one object
  // that the webview `partition` attribute, `tab.container`, AND the dot logic all derive
  // from. If the partition were set to the internal string while tab.container stayed
  // DEFAULT_CONTAINER, a New Identity click on the Settings tab would wipe the user's real
  // `persist:goldfinch` jar (identity-new reads tab.container.partition).
  const jar = trusted
    ? { id: 'internal', name: 'Settings', color: '#9aa0ac', partition: window.goldfinch.internalPartition }
    : container || DEFAULT_CONTAINER;

  // Both trusted (internal) and untrusted (web) tabs now use WebContentsView via IPC (Leg 3).
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
  btn.setAttribute('aria-keyshortcuts', 'Delete');
  btn.setAttribute('aria-label', 'New tab');
  // Colored dot for non-default jars. The internal (Settings) jar is treated like
  // default — no dot (it's chrome, not a user container).
  const dot =
    jar.id === 'default' || jar.id === 'internal'
      ? ''
      : `<span class="tab-jar" style="background:${jar.color}" title="${escapeHtml(jar.name)}${jar.burner ? ' (burner)' : ''}"></span>`;
  btn.innerHTML = `${dot}<img class="tab-fav hidden" alt="" /><span class="tab-title">New tab</span><button class="tab-close" tabindex="-1" aria-label="Close tab: New tab">✕</button>`;
  btn.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.tab-close')) {
      if (tabs.size > 1) freezeTabWidths(); // DD5: defer reflow on pointer-close (not last tab)
      closeTab(id);
      return;
    }
    activateTab(id);
  });
  els.tabs.appendChild(btn);
  tab.btn = btn;

  // All tabs (web and internal) use WebContentsView via IPC (Leg 3).
  // For internal tabs: trusted:true causes main to construct with internal webPreferences
  // (internal-preload.js, contextIsolation:true, sandbox:true, partition:INTERNAL_PARTITION).
  // For web tabs: trusted:false → web prefs (webview-preload.js, contextIsolation:false).
  // visibleWebTabWcId is web-only — internal tabs never freeze and never set it.
  window.goldfinch.tabCreate({ url, partition: jar.partition, trusted }).then((wcId) => {
    if (!tabs.has(id)) return; // tab was closed before wcId arrived
    tab.wcId = wcId;
    // If this tab is still active, refresh state now that wcId is available.
    if (tab.id === activeTabId) {
      // Make the WebContentsView visible now that its wcId has arrived.
      // activateTab() ran synchronously in createTab() with wcId still null,
      // so the tab-set-active IPC was skipped — send it here to show the view.
      window.goldfinch.tabSetActive(tab.wcId, measureWebviewsSlotWithInsetDIP());
      if (!trusted) {
        // Internal tabs never participate in the freeze-frame path (visibleWebTabWcId is web-only).
        visibleWebTabWcId = tab.wcId;
      }
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

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  // All tabs are WebContentsViews (Leg 3). Internal tabs (trusted) use tabClose just like web tabs.
  if (tab.wcId != null) {
    if (tab.wcId === visibleWebTabWcId) visibleWebTabWcId = null;
    window.goldfinch.tabClose(tab.wcId);
  }
  tab.btn.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const next = [...tabs.keys()].pop();
    if (next) activateTab(next);
    else createTab(); // never leave the window with zero tabs
  }
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  activeTabId = id;

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
  // Per-tab find restore (AC8 / DD3). Re-show the bar and re-issue findInPage so
  // the live count refreshes (intent only was cached; counts are always live-queried).
  // Tabs without findOpen stay hidden — new tabs have findOpen falsy, safe no-op.
  // NOTE: find-bar visibility is updated HERE before tabSetActive so that
  // measureWebviewsSlotWithInsetDIP() reads the correct inset for the incoming tab.
  if (tab.findOpen && !isInternalTab(tab)) {
    els.findBar.classList.remove('hidden');
    els.findInput.value = tab.findText || '';
    runFind(tab, { findNext: false });
  } else {
    els.findBar.classList.add('hidden');
    els.findCount.textContent = '';
  }

  if (tab.wcId != null) {
    // Send tab-set-active with bounds (main handles visibility + hides previous web tab).
    // tabSetActive is sent after the find-bar visibility update above so that
    // measureWebviewsSlotWithInsetDIP() uses the correct inset for this tab.
    window.goldfinch.tabSetActive(tab.wcId, measureWebviewsSlotWithInsetDIP());
    if (!tab.trusted) {
      // Internal tabs never participate in the freeze-frame path (visibleWebTabWcId is web-only).
      visibleWebTabWcId = tab.wcId;
    }
  } else if (tab.trusted) {
    // Internal tab: wcId not yet arrived — hide any previously-visible web tab while we wait.
    // The tabCreate .then() callback will call tabSetActive once wcId is available.
    if (visibleWebTabWcId != null) {
      window.goldfinch.tabHide(visibleWebTabWcId);
    }
    visibleWebTabWcId = null;
  } else {
    // Web tab: wcId not yet arrived — hide any previously-visible web tab while we wait.
    // The tabCreate .then() callback will call tabSetActive once wcId is available.
    if (visibleWebTabWcId != null) {
      window.goldfinch.tabHide(visibleWebTabWcId);
    }
    visibleWebTabWcId = null;
  }
  renderMedia();
  renderPrivacy();
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
  // Query the newly-active tab's live open state; the activeTabId === tab.id re-check
  // guards the async isDevtoolsOpen promise against a fast double-switch painting the
  // wrong tab's state. Internal / no-wcId tabs force pressed false (button is inert there).
  if (!isInternalTab(tab) && tab.wcId != null) {
    window.goldfinch.isDevtoolsOpen({ webContentsId: tab.wcId })
      .then((open) => { if (activeTabId === tab.id) setDevtoolsPressed(!!open); })
      .catch(() => {});
  } else {
    setDevtoolsPressed(false);
  }
}

function activeTab() {
  return tabs.get(activeTabId) || null;
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

/**
 * Update the address-bar chip and read-only state from the given tab.
 * Called from every address-sync site (activateTab, onNav, did-navigate-in-page).
 * @param {Tab|null} tab
 */
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
  chip.setAttribute('aria-label', host
    ? (secure ? `Site information, ${host}` : `Site information, ${host}, not secure`)
    : 'Site information');
  els.address.readOnly = false;
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

/**
 * Compute the top inset (in CSS px == DIP) to apply to the active guest view so that
 * the find bar (a top-anchored chrome popup) is not occluded by the guest.
 *
 * Only the find bar contributes to the inset. Site-info uses the freeze-frame approach
 * instead (sub-step 5): the guest is hidden while site-info is open, so no inset is
 * needed for it. Keeping site-info out of this function prevents a double-geometry-send
 * on open/close.
 *
 * @returns {number} inset in DIP pixels (≥ 0)
 */
function computeTopInsetDIP() {
  const webviewsTop = els.webviews.getBoundingClientRect().top;
  let inset = 0;

  // Find bar: visible when #find-bar does NOT have the 'hidden' class.
  if (!els.findBar.classList.contains('hidden')) {
    const fb = els.findBar.getBoundingClientRect();
    // fb.bottom is viewport-coord; subtract webviewsTop to get depth into the guest area.
    // Add a 4px breathing gap below the bar.
    inset = Math.max(inset, Math.ceil(fb.bottom - webviewsTop) + 4);
  }

  return Math.max(0, inset);
}

/**
 * Like measureWebviewsSlotDIP() but shrinks the guest from the top by the current
 * top inset (find bar or site-info popup height). When no popup is open the inset
 * is 0 and this is identical to measureWebviewsSlotDIP().
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function measureWebviewsSlotWithInsetDIP() {
  const base = measureWebviewsSlotDIP();
  const topInset = computeTopInsetDIP();
  return {
    x: base.x,
    y: base.y + topInset,
    width: base.width,
    height: base.height - topInset,
  };
}

// Debounced geometry send: sends the active web tab's bounds after a rAF,
// coalescing multiple rapid calls (resize, panel toggle) into one send.
function sendActiveBounds() {
  if (guestFrozen) return;
  if (rafGeometryPending) return;
  rafGeometryPending = true;
  requestAnimationFrame(() => {
    rafGeometryPending = false;
    const t = activeTab();
    // All active views (web AND internal) need geometry updates on resize/panel-toggle —
    // internal tabs are WebContentsViews now (Leg 3), not <webview> elements. Excluding
    // internal here stranded them at stale bounds until a tabSetActive (tab switch) re-bounded
    // them. measureWebviewsSlotWithInsetDIP returns the full slot for internal (find is web-only
    // → inset 0). The guestFrozen early-return above still correctly skips a frozen view.
    if (t && t.wcId != null) {
      window.goldfinch.tabSetBounds(t.wcId, measureWebviewsSlotWithInsetDIP());
    }
  });
}

/**
 * Freeze the active guest (web or internal): capture a still frame, set it as the #webviews
 * background, hide the live guest view. Returns true if the freeze was applied, false otherwise.
 * After Leg 3, internal goldfinch:// tabs are opaque WebContentsViews too, so they also occlude
 * the HTML chrome menus and must be freezable — the guard keys on the active view's wcId, not on
 * trust. (visibleWebTabWcId is web-only bookkeeping and is NOT used here; the freeze hides t.wcId
 * directly so it works for internal tabs whose wcId is never tracked in visibleWebTabWcId.)
 * @param {(() => boolean) | null} [stillOpen]  optional liveness check — if provided and
 *   returns false after the async capture, the freeze is aborted (popup was closed before
 *   the capture resolved).
 * @returns {Promise<boolean>}
 */
async function freezeGuest(stillOpen) {
  const t = activeTab();
  if (!t || t.wcId == null) return false;
  const dataURL = await window.goldfinch.captureActiveGuest();
  if (!dataURL) return false;
  if (stillOpen && !stillOpen()) return false;
  // Decode the still before hiding the live view so it paints in the same frame —
  // avoids a one-frame flash of empty #webviews (esp. visible on light internal pages).
  try { const img = new Image(); img.src = dataURL; await img.decode(); } catch { /* decode unsupported/failed → proceed; worst case the prior brief flash */ }
  if (stillOpen && !stillOpen()) return false;   // re-check liveness after the decode await
  els.webviews.style.backgroundImage = `url('${dataURL}')`;
  els.webviews.style.backgroundSize = '100% 100%';
  window.goldfinch.tabHide(t.wcId);
  guestFrozen = true;
  return true;
}

/**
 * Unfreeze: clear the still background and re-show the active guest (web or internal).
 * No-ops if no freeze is active. Re-shows whichever view is active; only the web-only
 * visibleWebTabWcId bookkeeping is updated for web tabs.
 */
function unfreezeGuest() {
  if (!guestFrozen) return;
  guestFrozen = false;
  els.webviews.style.backgroundImage = '';
  els.webviews.style.backgroundSize = '';
  const t = activeTab();
  if (t && t.wcId != null) {
    window.goldfinch.tabSetActive(t.wcId, measureWebviewsSlotWithInsetDIP());
    if (!t.trusted) visibleWebTabWcId = t.wcId;
  }
}

// wireWebview removed (Leg 3): all tabs — web and internal — are now WebContentsViews;
// no <webview> elements are constructed and wireWebview is unreachable. Tab-strip events
// (navigate, title, favicon, load, find) are forwarded from main via wireTabViewEvents +
// the module-level onTab* IPC subscriptions. Leg 4 removes will-attach-webview / webviewTag.

function updateNavButtons() {
  const tab = activeTab();
  if (!tab) { els.back.disabled = true; els.forward.disabled = true; return; }
  if (tab.trusted) {
    // Internal tabs never have navigation history — disable both buttons explicitly.
    // (No webview to query; tab-nav-state IPC is not sent for internal views.)
    els.back.disabled = true;
    els.forward.disabled = true;
  }
  // For web tabs: nav state is pushed via onTabNavState; buttons stay at last known state
}

/* ---------------------------------------------------------------- navigation */

function navigate(input) {
  const tab = activeTab();
  if (!tab) return;
  const url = toUrl(input);
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
  if (!tab.trusted && tab.wcId != null) {
    window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'loadURL', args: [url] });
  }
}

function toUrl(input) {
  const s = input.trim();
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith('about:')) return s;
  // Looks like a domain? (has a dot, no spaces)
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

els.address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(els.address.value);
    els.address.blur();
  }
});
els.back.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  // Internal tabs have back disabled; web tabs use the view IPC path.
  if (!t.trusted && t.wcId != null) { window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'goBack', args: [] }); }
});
els.forward.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  // Internal tabs have forward disabled; web tabs use the view IPC path.
  if (!t.trusted && t.wcId != null) { window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'goForward', args: [] }); }
});
els.reload.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  // Internal tabs: reload button is not wired (no navigation history to stop/reload).
  if (!t.trusted && t.wcId != null) {
    if (els.reload.textContent === '✕') window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'stop', args: [] });
    else window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
  }
});
els.newTab.addEventListener('click', () => createTab());
els.newTabMenu.addEventListener('click', () => {
  if (menuController.current === containerEntry) menuController.close(containerEntry);
  else menuController.open(containerEntry, 0);
});

// --- custom window controls (win+linux frameless; hidden on macOS) ---
els.winMin.addEventListener('click', () => window.goldfinch.windowMinimize());
els.winMax.addEventListener('click', () => window.goldfinch.windowToggleMaximize());
els.winClose.addEventListener('click', () => window.goldfinch.windowClose());
function setMaximized(isMax) {
  els.winMax.setAttribute('data-state', isMax ? 'maximized' : 'normal');
  els.winMax.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
  els.winMax.title = isMax ? 'Restore' : 'Maximize';
  // Icon is drawn in CSS keyed off data-state (normal=square, maximized=restore pair);
  // no textContent so the CSS pseudo-element glyphs aren't clobbered.
}
window.goldfinch.windowIsMaximized().then(setMaximized);
window.goldfinch.onWindowMaximizedChange(setMaximized);

function focusTab(id) {
  const t = tabs.get(id);
  if (t && t.btn) /** @type {HTMLElement} */ (t.btn).focus();
}
els.tabs.addEventListener('keydown', (e) => {
  const ids = [...tabs.keys()];
  if (!ids.length) return;
  // Cast the closest() RESULT (Element|null) to HTMLElement so `.dataset` typechecks —
  // `.closest()` returns Element regardless of receiver, and `.dataset` is HTMLElement-only.
  const cur = /** @type {HTMLElement|null} */ (document.activeElement?.closest('.tab'))?.dataset.id || activeTabId;
  const idx = Math.max(0, ids.indexOf(cur));
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const next = ids[(idx + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    activateTab(next);
    focusTab(next);
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const next = e.key === 'Home' ? ids[0] : ids[ids.length - 1];
    activateTab(next);
    focusTab(next);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    releaseTabWidths(); // keyboard close always reflows immediately (DD5) — clears any active freeze
    closeTab(cur);
    const now = activeTab();
    if (now && now.btn) focusTab(now.id);
  }
});

/* --------------------------------------------------------------- media panel */

function togglePanel(force) {
  const collapsed = els.panel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  els.panel.classList.toggle('collapsed', !show);
  els.toggleMedia.classList.toggle('active', show);
  els.toggleMedia.setAttribute('aria-expanded', String(show));
  if (show) {
    closePrivacyPanel(); // only one right-side panel at a time
    els.mediaClose.focus(); // only move focus when actually opening
  } else if (els.panel.contains(document.activeElement)) {
    // Closing while focus is inside the (now zero-width) panel would strand it:
    // restore focus to the toggle. Guard avoids stealing focus on programmatic
    // closes where focus isn't in the panel (e.g. opening the privacy panel).
    // Focus-restoration guard: if the button is unpinned (hidden), .focus() is a
    // silent no-op that strands focus on <body> — skip it when the button is hidden.
    if (!els.toggleMedia.classList.contains('hidden')) els.toggleMedia.focus();
  }
}
els.toggleMedia.addEventListener('click', () => { togglePanel(); sendActiveBounds(); });
els.toggleMedia.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('media', els.toggleMedia); });
els.mediaClose.addEventListener('click', () => { togglePanel(false); sendActiveBounds(); });
// Non-modal: Escape closes the media panel; togglePanel restores focus to the toggle.
els.panel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePanel(false);
    sendActiveBounds();
  }
});
els.mediaRescan.addEventListener('click', () => {
  const t = activeTab();
  // Internal tabs (trusted) are excluded by the disabled button state (tab-scoped toolbar disable).
  if (!t || t.wcId == null || t.trusted) return;
  window.goldfinch.rescanMedia({ wcId: t.wcId });
});

els.filters.forEach((f) =>
  f.addEventListener('click', () => {
    els.filters.forEach((x) => {
      const isActive = x === f;
      x.classList.toggle('active', isActive);
      // Non-color cue (WCAG 1.4.1): expose the active filter to AT via aria-pressed.
      x.setAttribute('aria-pressed', String(isActive));
    });
    activeFilter = f.dataset.filter;
    renderMedia();
  })
);

// Items currently shown in the panel, honoring the active filter.
function visibleItems() {
  const media = (activeTab() && activeTab().media) || [];
  return activeFilter === 'all' ? media : media.filter((m) => m.type === activeFilter);
}

function renderMedia() {
  const tab = activeTab();
  const media = (tab && tab.media) || [];
  const filtered = visibleItems();

  els.mediaCount.textContent = media.length ? String(media.length) : '';
  els.mediaCount.classList.toggle('hidden', !media.length);
  els.toggleMedia.setAttribute('aria-label', media.length ? 'Media, ' + media.length + ' items' : 'Media');
  els.mediaList.innerHTML = '';
  els.mediaEmpty.classList.toggle('hidden', filtered.length > 0);
  els.mediaStatus.textContent = filtered.length
    ? `${filtered.length} media item${filtered.length === 1 ? '' : 's'}`
    : 'No media on this page';

  for (const item of filtered) els.mediaList.appendChild(mediaCard(item, tab));
  updateDownloadSelected();
}

function mediaCard(item, tab) {
  const card = document.createElement('div');
  card.className = 'media-card';
  card.dataset.url = item.url;

  const thumb = document.createElement('div');
  thumb.className = 'media-thumb';

  // Top-left overlay: selection checkbox (downloadable items only) + type badge.
  const pick = document.createElement('label');
  pick.className = 'media-pick';
  if (item.type !== 'embed') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    // Unique, descriptive name per item (the wrapping <label> only carries the
    // type badge, so this gives AT a distinguishable name for each checkbox).
    cb.setAttribute('aria-label', `Select ${item.label || item.name}`);
    cb.checked = tab.selected.has(item.url);
    if (cb.checked) card.classList.add('selected');
    pick.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) tab.selected.add(item.url);
      else tab.selected.delete(item.url);
      card.classList.toggle('selected', cb.checked);
      updateDownloadSelected();
    });
    pick.appendChild(cb);
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.type;
  pick.appendChild(badge);
  thumb.appendChild(pick);

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.url;
    img.alt = item.label || item.name || '';
    thumb.appendChild(img);
    thumb.title = 'Open in viewer';
    thumb.addEventListener('click', () => openLightbox(item));
  } else if (item.type === 'video') {
    if (isSafePosterUrl(item.poster)) thumb.style.backgroundImage = `url("${item.poster}")`;
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">▶</span>`);
    thumb.title = 'Play here';
    thumb.addEventListener('click', () => playInline(item, thumb));
  } else if (item.type === 'audio') {
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">♪</span>`);
    thumb.title = 'Play in player';
    thumb.addEventListener('click', () => playAudio(item));
    if (player.url === item.url) card.classList.add('playing');
  } else {
    // embed
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">⧉</span>`);
    thumb.title = 'Open in new tab';
    thumb.addEventListener('click', () => popout(item));
  }
  card.appendChild(thumb);

  const meta = document.createElement('div');
  meta.className = 'media-meta';
  const dims = item.width && item.height ? `${item.width}×${item.height}` : '';
  const primary = item.label || item.name;
  const secondary = item.label && item.name !== item.label ? item.name : dims;
  meta.innerHTML =
    `<div class="media-name">${escapeHtml(primary)}</div>` +
    (secondary ? `<div class="media-dims">${escapeHtml(secondary)}</div>` : '');
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'media-actions';

  // Audio plays in the docked player; video plays inline in its card.
  if (item.type === 'audio') actions.appendChild(iconBtn('▶', 'Play', () => playAudio(item)));
  else if (item.type === 'video') actions.appendChild(iconBtn('▶', 'Play here', () => playInline(item, thumb)));

  // Every item gets a pop-out: images -> zoomable viewer, AV -> full-size tab.
  actions.appendChild(
    iconBtn('↗', item.type === 'image' ? 'Open in viewer' : 'Pop out to new tab', () => popout(item))
  );

  // Download (everything except non-fetchable embeds).
  if (item.type !== 'embed') {
    const dl = iconBtn('⇩', 'Download', () => downloadItem(item, tab));
    dl.classList.add('primary');
    actions.appendChild(dl);
  }
  card.appendChild(actions);
  return card;
}

function iconBtn(glyph, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-action';
  b.textContent = glyph;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

// Swap a video/audio card's thumbnail for a live, playing player in place.
function playInline(item, thumb) {
  if (thumb.dataset.playing === '1') return;
  thumb.dataset.playing = '1';
  thumb.style.cursor = 'default';
  thumb.style.backgroundImage = 'none';
  thumb.classList.add(item.type === 'audio' ? 'audio-live' : 'video-live');
  thumb.innerHTML = `<label class="media-pick"><span class="badge">${item.type}</span></label>`;
  const player = document.createElement(item.type === 'video' ? 'video' : 'audio');
  player.src = item.url;
  player.controls = true;
  player.autoplay = true;
  player.className = 'inline-player';
  thumb.appendChild(player);
}

// Pop a media item out of the panel into its best full view.
function popout(item) {
  if (item.type === 'image') {
    openLightbox(item);
    return;
  }
  createTab(item.url); // video / audio / embed open full-size as a real tab
}

/* ---- image lightbox with zoom & pan ---- */

const zoom = { scale: 1, tx: 0, ty: 0, img: null };

function applyZoom() {
  if (!zoom.img) return;
  zoom.img.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
  els.lightboxZoomLevel.textContent = `${Math.round(zoom.scale * 100)}%`;
}

function centerImage() {
  if (!zoom.img) return;
  const stage = els.lightboxStage.getBoundingClientRect();
  zoom.scale = 1;
  zoom.tx = (stage.width - zoom.img.offsetWidth) / 2;
  zoom.ty = (stage.height - zoom.img.offsetHeight) / 2;
  applyZoom();
}

function resetZoom() {
  centerImage();
}

function setScale(next, originX, originY) {
  const stage = els.lightboxStage.getBoundingClientRect();
  const cx = (originX != null ? originX : stage.left + stage.width / 2) - stage.left;
  const cy = (originY != null ? originY : stage.top + stage.height / 2) - stage.top;
  const prev = zoom.scale;
  next = Math.min(8, Math.max(0.2, next));
  // Keep the point under the cursor stationary while zooming.
  zoom.tx = cx - (cx - zoom.tx) * (next / prev);
  zoom.ty = cy - (cy - zoom.ty) * (next / prev);
  zoom.scale = next;
  applyZoom();
}

/** @type {HTMLElement|null} */
let lbReturnFocus = null;

function openLightbox(item) {
  lbReturnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  els.lightboxStage.innerHTML = '';
  const img = document.createElement('img');
  img.src = item.url;
  img.alt = item.label || item.name || '';
  img.className = 'lightbox-img';
  img.draggable = false;
  els.lightboxStage.appendChild(img);
  zoom.img = img;
  els.lightboxCaption.textContent = item.label || item.name;
  els.lightbox.classList.remove('hidden');
  els.lightboxClose.focus(); // move focus into the modal dialog
  // Center once the image has real dimensions (lightbox must be visible first).
  if (img.complete && img.naturalWidth) centerImage();
  img.addEventListener('load', centerImage, { once: true });
}

function closeLightbox() {
  els.lightbox.classList.add('hidden');
  els.lightboxStage.innerHTML = '';
  zoom.img = null;
  if (lbReturnFocus) lbReturnFocus.focus(); // restore focus to the opener
  lbReturnFocus = null;
}

els.lightboxClose.addEventListener('click', closeLightbox);
els.lightboxZoomIn.addEventListener('click', () => setScale(zoom.scale * 1.25));
els.lightboxZoomOut.addEventListener('click', () => setScale(zoom.scale / 1.25));
els.lightboxZoomReset.addEventListener('click', resetZoom);

// Close when clicking the dimmed backdrop (but not the image or toolbar).
els.lightbox.addEventListener('click', (e) => {
  if (e.target === els.lightbox || e.target === els.lightboxStage) closeLightbox();
});

// Wheel to zoom toward the cursor.
els.lightboxStage.addEventListener(
  'wheel',
  (e) => {
    if (!zoom.img) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale(zoom.scale * factor, e.clientX, e.clientY);
  },
  { passive: false }
);

// Double-click toggles fit / 2x.
els.lightboxStage.addEventListener('dblclick', (e) => {
  if (zoom.scale > 1.01) resetZoom();
  else setScale(2, e.clientX, e.clientY);
});

// Drag to pan when zoomed in.
let panning = null;
els.lightboxStage.addEventListener('mousedown', (e) => {
  if (!zoom.img || zoom.scale <= 1) return;
  panning = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
  els.lightboxStage.classList.add('grabbing');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  zoom.tx = panning.tx + (e.clientX - panning.x);
  zoom.ty = panning.ty + (e.clientY - panning.y);
  applyZoom();
});
window.addEventListener('mouseup', () => {
  panning = null;
  els.lightboxStage.classList.remove('grabbing');
});

// Esc closes; +/- zoom; 0 resets; Tab traps focus within the modal dialog.
document.addEventListener('keydown', (e) => {
  if (els.lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === '+' || e.key === '=') setScale(zoom.scale * 1.25);
  else if (e.key === '-') setScale(zoom.scale / 1.25);
  else if (e.key === '0') resetZoom();
  else if (e.key === 'Tab') {
    const f = /** @type {NodeListOf<HTMLElement>} */ (els.lightbox.querySelectorAll('button'));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement;
    let idx = -1;
    for (let i = 0; i < f.length; i++) {
      if (f[i] === active) {
        idx = i;
        break;
      }
    }
    // Focus left the button set (e.g. blurred to the image/backdrop) — pull it back in.
    if (idx === -1) {
      (e.shiftKey ? last : first).focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    } else if (e.shiftKey && active === first) {
      last.focus();
      e.preventDefault();
    }
  }
});

async function downloadItem(item, tab) {
  const res = await window.goldfinch.downloadMedia({
    webContentsId: tab ? tab.wcId : null,
    url: item.url,
    suggestedName: item.name
  });
  if (!res || !res.ok) toast('Download failed', res && res.error ? res.error : 'Unknown error');
}

/* ------------------------------------------------------- download selected */

const bulk = {
  active: false,
  queue: [],
  inFlight: 0,
  max: 4,
  done: 0,
  ok: 0,
  fail: 0,
  total: 0,
  dir: null,
  tab: null,
  urls: new Set(),
  toastEl: null
};

// Downloadable items currently selected in the active tab.
function selectedItems() {
  const tab = activeTab();
  if (!tab) return [];
  return tab.media.filter((i) => i.type !== 'embed' && tab.selected.has(i.url));
}

function updateDownloadSelected() {
  const n = selectedItems().length;
  els.mediaDownloadSelected.disabled = n === 0;
  els.mediaDownloadSelected.textContent = n ? `Download selected (${n})` : 'Download selected';
}

async function downloadSelected() {
  if (bulk.active) {
    toast('Already downloading', `Batch in progress (${bulk.done}/${bulk.total}).`);
    return;
  }
  const tab = activeTab();
  const items = selectedItems();
  if (!items.length) return;
  if (items.length > 30 && !window.confirm(`Download ${items.length} files into a folder?`)) return;

  const dir = await window.goldfinch.chooseDownloadDir();
  if (!dir) return;

  Object.assign(bulk, {
    active: true,
    queue: items.slice(),
    inFlight: 0,
    done: 0,
    ok: 0,
    fail: 0,
    total: items.length,
    dir,
    tab,
    urls: new Set()
  });
  bulk.toastEl = persistentToast(`Downloading 0/${bulk.total}…`, dir);
  bulkPump();
}

function bulkPump() {
  while (bulk.active && bulk.inFlight < bulk.max && bulk.queue.length) {
    const item = bulk.queue.shift();
    bulk.inFlight++;
    bulk.urls.add(item.url);
    window.goldfinch
      .downloadMedia({
        webContentsId: bulk.tab && bulk.tab.wcId,
        url: item.url,
        suggestedName: item.name,
        saveDir: bulk.dir
      })
      .then((res) => {
        if (!res || !res.ok) bulkComplete(item.url, false);
      });
  }
}

// Called from the global download-done handler for any bulk URL.
function bulkComplete(url, success) {
  if (!bulk.active || !bulk.urls.has(url)) return;
  bulk.urls.delete(url);
  bulk.inFlight--;
  bulk.done++;
  success ? bulk.ok++ : bulk.fail++;
  if (bulk.toastEl) bulk.toastEl.querySelector('.toast-title').textContent = `Downloading ${bulk.done}/${bulk.total}…`;
  if (bulk.queue.length) bulkPump();
  else if (bulk.inFlight === 0) bulkFinish();
}

function bulkFinish() {
  const dir = bulk.dir;
  const el = bulk.toastEl;
  if (el) {
    el.querySelector('.toast-title').textContent = 'Download all complete';
    el.querySelector('.toast-body').textContent = `${bulk.ok} saved${bulk.fail ? `, ${bulk.fail} failed` : ''}`;
    const link = document.createElement('a');
    link.textContent = ' — Show folder';
    link.addEventListener('click', () => window.goldfinch.showItemInFolder(dir));
    el.appendChild(link);
    setTimeout(() => el.remove(), 8000);
  }
  bulk.active = false;
  bulk.toastEl = null;
}

els.mediaDownloadSelected.addEventListener('click', downloadSelected);

/* --------------------------------------------------- docked music player */

const player = { list: [], index: -1, url: null };
const pa = els.playerAudio;

function currentAudioItems() {
  const t = activeTab();
  return ((t && t.media) || []).filter((m) => m.type === 'audio');
}

// Start a track; the page's audio list becomes the playlist for prev/next.
function playAudio(item) {
  player.list = currentAudioItems();
  player.index = player.list.findIndex((m) => m.url === item.url);
  if (player.index < 0) {
    player.list = [item];
    player.index = 0;
  }
  loadCurrent();
}

function loadCurrent() {
  const item = player.list[player.index];
  if (!item) return;
  player.url = item.url;
  pa.src = item.url;
  pa.play().catch(() => {});
  els.playerTitle.textContent = item.label || item.name;
  els.player.classList.remove('hidden');
  els.playerPrev.disabled = player.index <= 0;
  els.playerNext.disabled = player.index >= player.list.length - 1;
  highlightPlaying();
}

function highlightPlaying() {
  document.querySelectorAll('.media-card').forEach((c) => {
    const card = /** @type {HTMLElement} */ (c);
    card.classList.toggle('playing', card.dataset.url === player.url);
  });
}

function togglePlay() {
  if (!pa.src) return;
  if (pa.paused) pa.play().catch(() => {});
  else pa.pause();
}
function playPrev() {
  if (player.index > 0) {
    player.index--;
    loadCurrent();
  }
}
function playNext() {
  if (player.index < player.list.length - 1) {
    player.index++;
    loadCurrent();
  }
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

els.playerPlay.addEventListener('click', togglePlay);
els.playerPrev.addEventListener('click', playPrev);
els.playerNext.addEventListener('click', playNext);
els.playerSeek.addEventListener('click', (e) => {
  const r = els.playerSeek.getBoundingClientRect();
  if (isFinite(pa.duration)) pa.currentTime = ((e.clientX - r.left) / r.width) * pa.duration;
});
pa.addEventListener('timeupdate', () => {
  const ratio = pa.duration ? pa.currentTime / pa.duration : 0;
  els.playerProgress.style.width = `${ratio * 100}%`;
  els.playerCur.textContent = fmtTime(pa.currentTime);
});
pa.addEventListener('loadedmetadata', () => {
  els.playerDur.textContent = fmtTime(pa.duration);
});
pa.addEventListener('play', () => {
  els.playerPlay.textContent = '▮▮';
});
pa.addEventListener('pause', () => {
  els.playerPlay.textContent = '▶';
});
pa.addEventListener('ended', () => {
  if (player.index < player.list.length - 1) playNext();
});

/* --------------------------------------------------------- privacy panel */

function blankPrivacy() {
  return { net: null, fp: { canvas: 0, webgl: 0, audio: 0 }, permissions: [], cookies: null };
}

function findTabByWcId(id) {
  for (const t of tabs.values()) if (t.wcId === id) return t;
  return null;
}

function closePrivacyPanel() {
  els.privacyPanel.classList.add('collapsed');
  els.togglePrivacy.classList.remove('active');
  // Opening the media panel calls this directly, so sync aria-expanded here too
  // or the privacy toggle would keep a stale "true" after being collapsed.
  els.togglePrivacy.setAttribute('aria-expanded', 'false');
}

function togglePrivacy(force) {
  const collapsed = els.privacyPanel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  els.privacyPanel.classList.toggle('collapsed', !show);
  els.togglePrivacy.classList.toggle('active', show);
  els.togglePrivacy.setAttribute('aria-expanded', String(show));
  if (show) {
    togglePanel(false); // close the media panel
    fetchCookies(); // cookies are fetched on demand
    renderPrivacy();
    els.privacyClose.focus(); // only move focus when actually opening
  } else if (els.privacyPanel.contains(document.activeElement)) {
    // Closing while focus is inside the (now zero-width) panel would strand it:
    // restore focus to the toggle. Guard avoids stealing focus on programmatic closes.
    // Focus-restoration guard: if the button is unpinned (hidden), .focus() is a
    // silent no-op that strands focus on <body> — skip it when the button is hidden.
    if (!els.togglePrivacy.classList.contains('hidden')) els.togglePrivacy.focus();
  }
}

els.togglePrivacy.addEventListener('click', () => { togglePrivacy(); sendActiveBounds(); });
els.togglePrivacy.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('shields', els.togglePrivacy); });

/* ------------------------------------------------------------------ devtools toggle */

// The #toggle-devtools button is a toggle reflecting the active web tab's DevTools
// open state (aria-pressed + .active styling — NOT aria-expanded; it controls no
// in-page panel). Open state's source of truth is wc.isDevToolsOpened() main-side
// (DD3); the pressed state is driven by (a) the post-toggle return of toggleDevtools,
// (b) the devtools-state-changed event, and (c) the isDevtoolsOpen reconcile on tab
// activation. Never cached.

/** @param {boolean} open */
function setDevtoolsPressed(open) {
  els.toggleDevtools.setAttribute('aria-pressed', String(open));
  els.toggleDevtools.classList.toggle('active', open);
}

els.toggleDevtools.addEventListener('click', async () => {
  const t = activeTab();
  // Inert on internal / no-wcId tabs (DD5) — never opens DevTools on goldfinch:// chrome.
  if (!t || isInternalTab(t) || t.wcId == null) return;
  const open = await window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
  setDevtoolsPressed(!!open);
});
els.toggleDevtools.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('devtools', els.toggleDevtools); });

// Live update from the Leg-1 devtools-state-changed event (catches a DevTools-window-
// initiated close). Apply only when the change targets the currently-active tab.
window.goldfinch.onDevtoolsStateChanged(({ wcId, open }) => {
  const t = activeTab();
  if (t && t.wcId === wcId) setDevtoolsPressed(!!open);
});
els.privacyClose.addEventListener('click', () => { togglePrivacy(false); sendActiveBounds(); });
// Non-modal: Escape closes the privacy panel; togglePrivacy restores focus to the toggle.
els.privacyPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePrivacy(false);
    sendActiveBounds();
  }
});
els.privacyRefresh.addEventListener('click', () => {
  fetchCookies();
  renderPrivacy();
});

window.goldfinch.onPrivacyNet((d) => {
  const tab = findTabByWcId(d.webContentsId);
  if (!tab) return;
  tab.privacy.net = d.agg;
  if (tab.id === activeTabId) renderPrivacy();
  updatePrivacyBadge();
});

window.goldfinch.onPrivacyPermission((d) => {
  const tab = findTabByWcId(d.webContentsId);
  if (!tab) return;
  const existing = tab.privacy.permissions.find((p) => p.permission === d.permission);
  if (existing) existing.granted = d.granted;
  else tab.privacy.permissions.push({ permission: d.permission, granted: d.granted });
  if (tab.id === activeTabId) renderPrivacy();
});

async function fetchCookies() {
  const tab = activeTab();
  if (!tab || tab.wcId == null) return;
  try {
    tab.privacy.cookies = await window.goldfinch.privacyCookies({ webContentsId: tab.wcId, url: tab.url });
    if (tab.id === activeTabId) renderPrivacy();
  } catch {
    /* ignore */
  }
}

async function clearCookies(scope) {
  const tab = activeTab();
  if (!tab) return;
  const res = await window.goldfinch.privacyClearCookies({ webContentsId: tab.wcId, scope, url: tab.url });
  toast('Cookies cleared', `${res.removed} cookie(s) removed`);
  fetchCookies();
}

async function clearStorage() {
  const tab = activeTab();
  if (!tab) return;
  const res = await window.goldfinch.privacyClearStorage({ url: tab.url });
  toast(res.ok ? 'Site storage cleared' : 'Clear failed', res.ok ? res.origin : res.error || '');
}

function updatePrivacyBadge() {
  const tab = activeTab();
  const n = tab && tab.privacy.net ? tab.privacy.net.trackers.count : 0;
  // The badge count is the non-color cue (WCAG 1.4.1): the red `.alert` styling
  // is reinforced by the visible tracker count (badge + aria-label) so state isn't
  // conveyed by color alone.
  els.privacyCount.textContent = n ? String(n) : '';
  els.privacyCount.classList.toggle('hidden', !n);
  els.togglePrivacy.setAttribute('aria-label', n ? 'Shields, ' + n + ' blocked' : 'Shields');
  els.togglePrivacy.classList.toggle('alert', n > 0);
}

/* ---- Shields config (active protection toggles) ---- */

let shieldsConfig = null;
window.goldfinch.shieldsGet().then((c) => {
  shieldsConfig = c;
  renderPrivacy();
});
window.goldfinch.onShieldsChanged((c) => {
  shieldsConfig = c;
  renderPrivacy();
});

/* ---- Automation activity indicator (SC10 / DD6) ---- */

// The last snapshot received, cached so the jarsList() resolve can re-run the render
// with friendly jar names once `containers` is populated (the snapshot can arrive first).
let lastSnap = /** @type {{ sessions?: any[] }} */ ({ sessions: [] });

/**
 * Map a jarId to its display name via the loaded `containers`, falling back to the raw
 * jarId when the jar isn't (yet) known. jarId is operator-controlled, so the result is
 * only ever used via textContent / title — never innerHTML.
 * @param {string|null} jarId
 * @returns {string}
 */
function jarDisplayName(jarId) {
  const c = containers.find((x) => x.id === jarId);
  return c ? c.name : (jarId || 'jar');
}

/**
 * Render the toolbar automation indicator from an activity snapshot. Hidden + badge
 * cleared when there are no sessions; otherwise shows a count badge and a descriptive
 * title/aria-label naming each attached identity ("admin" or the jar's display name).
 * The `.admin` class applies a non-alarm distinct color when any session is an admin
 * session. Wording is "connected" (transport lifecycle), never "authorized" (DD6).
 * @param {{ sessions?: any[] }} snap
 */
function updateAutomationIndicator(snap) {
  lastSnap = snap || { sessions: [] };
  const sessions = (lastSnap && lastSnap.sessions) || [];
  const n = sessions.length;
  els.automationIndicator.classList.toggle('hidden', n === 0);
  if (!n) {
    els.automationIndicatorBadge.textContent = '';
    els.automationIndicatorBadge.classList.add('hidden');
    els.automationIndicator.classList.remove('admin');
    return;
  }
  const hasAdmin = sessions.some((s) => s.kind === 'admin');
  const names = sessions.map((s) => (s.kind === 'admin' ? 'admin' : jarDisplayName(s.jarId)));
  els.automationIndicatorBadge.textContent = String(n);
  els.automationIndicatorBadge.classList.remove('hidden');
  els.automationIndicator.classList.toggle('admin', hasAdmin);
  const label = n + ' automation session' + (n > 1 ? 's' : '') + ' connected: ' + names.join(', ');
  els.automationIndicator.title = label;
  els.automationIndicator.setAttribute('aria-label', label);
}

// Initial snapshot (catches sessions attached before the chrome loaded) + live updates.
window.goldfinch.automationGetActivity().then(updateAutomationIndicator).catch(() => {});
window.goldfinch.onAutomationActivity(updateAutomationIndicator);

/**
 * Show or hide the Media/Shields toolbar icons per the current pin state.
 * Unpinned → button hidden (`.hidden`); keyboard shortcuts remain active.
 * NOTE: the automation indicator is deliberately NOT touched here — it self-manages
 * its `.hidden` state from the live session count (SC10/DD6), and is not pinnable.
 * @param {{ media: boolean, shields: boolean, devtools: boolean }} pins
 */
function applyToolbarPins(pins) {
  els.toggleMedia.classList.toggle('hidden', !pins.media);
  els.togglePrivacy.classList.toggle('hidden', !pins.shields);
  // DD5: pin-state-driven only — never coupled to the active tab type. The button
  // stays visible on internal tabs (its click no-ops via the isInternalTab guard).
  els.toggleDevtools.classList.toggle('hidden', !pins.devtools);
}

window.goldfinch.settingsGet('toolbarPins').then(applyToolbarPins).catch(() => {});

window.goldfinch.onSettingsChanged((all) => {
  if (all && all.homePage !== undefined) homePageCache = all.homePage || HOMEPAGE;
  if (all && all.toolbarPins) applyToolbarPins(all.toolbarPins);
});

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
  if (queriedId !== activeTabId) return;
  const pct = Math.round((factor ?? 1.0) * 100) + '%';
  els.zoomPercent.textContent = pct;
  els.zoomPercent.setAttribute('aria-label', `Current zoom ${pct}`);
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

/* ----------------------------------------------------------------- find in page (SC4 / DD1–DD3 / DD5) */

/**
 * Run findInPage on the given tab's webview for the current findText.
 * Empty findText → no search issued (blank count, no highlight).
 * @param {Tab} tab
 * @param {{ findNext?: boolean, forward?: boolean }} [opts]
 */
function runFind(tab, opts = {}) {
  const text = tab.findText || '';
  if (!text) {
    els.findCount.textContent = '';
    return;
  }
  // Internal tabs are excluded by openFind's isInternalTab guard; only web tabs reach here.
  if (!tab.trusted && tab.wcId != null) {
    window.goldfinch.tabFind({ wcId: tab.wcId, text, options: { findNext: false, forward: true, matchCase: false, ...opts } });
  }
}

/**
 * Open the find bar for the given tab (or the current active tab if omitted).
 * Guards: no bar on internal tabs, no bar when the lightbox is open.
 * @param {Tab|null} [tab]
 */
function openFind(tab) {
  const t = tab || activeTab();
  if (!t || isInternalTab(t) || t.wcId == null) return;
  // Don't fight the lightbox (DD2 / AC6).
  if (!els.lightbox.classList.contains('hidden')) return;
  t.findOpen = true;
  els.findBar.classList.remove('hidden');
  // Inset the guest from the top so the find bar (which lives in the chrome doc
  // and is now visible) is not occluded by the opaque native WebContentsView.
  // sendActiveBounds reads computeTopInsetDIP() which detects the bar is visible.
  sendActiveBounds();
  if (t.findText) {
    els.findInput.value = t.findText;
    runFind(t, { findNext: false });
  } else {
    els.findInput.value = '';
    els.findCount.textContent = '';
  }
  els.findInput.focus();
  els.findInput.select();
}

/**
 * Close the find bar: clear the highlight, hide the bar, and restore focus to the page.
 * @param {Tab|null} [tab]
 */
function closeFind(tab) {
  const t = tab || activeTab();
  els.findBar.classList.add('hidden');
  els.findCount.textContent = '';
  // Restore the guest's full bounds now that the find bar is hidden (inset = 0 from it).
  sendActiveBounds();
  if (t) {
    t.findOpen = false;
    // Internal tabs are excluded by openFind's isInternalTab guard; only web tabs reach here.
    if (!t.trusted && t.wcId != null) {
      window.goldfinch.tabFind({ wcId: t.wcId, stop: true, options: 'clearSelection' });
    }
  }
}

// Wire find-bar UI events.
els.findInput.addEventListener('input', () => {
  const t = activeTab();
  if (!t || !t.findOpen) return;
  t.findText = els.findInput.value;
  runFind(t, { findNext: false });
});

els.findInput.addEventListener('keydown', (e) => {
  const t = activeTab();
  if (!t) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!t.findText) return;
    runFind(t, { findNext: true, forward: !e.shiftKey });
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind(t);
  }
});

els.findNext.addEventListener('click', () => {
  const t = activeTab();
  if (t && t.findText) runFind(t, { findNext: true, forward: true });
});
els.findPrev.addEventListener('click', () => {
  const t = activeTab();
  if (t && t.findText) runFind(t, { findNext: true, forward: false });
});
els.findClose.addEventListener('click', () => closeFind(activeTab()));

// Main-side Ctrl+F capture → open find (page-focused path, DD2).
window.goldfinch.onOpenFind(() => openFind());

// Main-side Ctrl+J capture → open downloads (page-focused path, DD2). No active-internal
// guard here: this only fires when a web page had focus, so the active tab is web by construction.
window.goldfinch.onOpenDownloads(() => openDownloads());

function currentSite() {
  const tab = activeTab();
  if (tab && tab.privacy.net && tab.privacy.net.firstParty) return tab.privacy.net.firstParty;
  try {
    const h = new URL(tab.url).hostname.split('.');
    return h.length <= 2 ? h.join('.') : h.slice(-2).join('.');
  } catch {
    return '';
  }
}

async function setShield(key, value) {
  shieldsConfig = await window.goldfinch.shieldsSet({ [key]: value });
  renderPrivacy();
}

async function toggleSitePause() {
  const site = currentSite();
  if (!site) return;
  const paused = shieldsConfig && shieldsConfig.pausedSites.includes(site);
  shieldsConfig = await window.goldfinch.shieldsPause({ site, paused: !paused });
  renderPrivacy();
}

const SHIELD_ROWS = [
  ['block', 'Block trackers'],
  ['strip', 'Strip tracking params'],
  ['isolate', 'Isolate 3rd-party cookies'],
  ['farble', 'Farble fingerprint']
];

function pShields() {
  const s = document.createElement('div');
  s.className = 'privacy-section shields';
  const cfg = shieldsConfig || {};
  const site = currentSite();
  const paused = cfg.pausedSites && cfg.pausedSites.includes(site);

  const head = document.createElement('div');
  head.className = 'shields-head';
  head.innerHTML = '<div class="ps-title">Shields</div>';
  head.appendChild(toggle(!!cfg.enabled, (v) => setShield('enabled', v), 'Shields'));
  s.appendChild(head);

  const net = (activeTab() && activeTab().privacy.net) || {};
  // Counts are distinct DOMAINS so they line up with the lists below
  // (block -> Trackers "N blocked", isolate/strip -> distinct domains affected).
  const EFFECT = {
    block: [(net.trackers && net.trackers.blocked) || 0, 'blocked'],
    strip: [net.stripped, 'cleaned'],
    isolate: [net.cookiesBlocked, 'isolated']
  };

  const dim = !cfg.enabled || paused;
  for (const [key, label] of SHIELD_ROWS) {
    const row = document.createElement('div');
    row.className = 'shield-row' + (dim ? ' dim' : '');
    const lbl = document.createElement('span');
    lbl.className = 'shield-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);
    const eff = EFFECT[key];
    if (cfg[key] && !dim && eff && eff[0]) {
      const c = document.createElement('span');
      c.className = 'shield-count';
      c.textContent = `${eff[0]} ${eff[1]}`;
      row.appendChild(c);
    }
    row.appendChild(toggle(!!cfg[key], (v) => setShield(key, v), label));
    s.appendChild(row);
  }

  if (site) {
    const pauseRow = document.createElement('div');
    pauseRow.className = 'shield-row pause';
    pauseRow.innerHTML = `<span>${paused ? 'Shields paused on' : 'Active on'} ${escapeHtml(site)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'text-btn small';
    btn.textContent = paused ? 'Resume here' : 'Pause on this site';
    btn.addEventListener('click', toggleSitePause);
    pauseRow.appendChild(btn);
    s.appendChild(pauseRow);
  }

  // Network shields only affect NEW requests, so changes show after a reload.
  const foot = document.createElement('div');
  foot.className = 'shield-foot';
  const reload = document.createElement('button');
  reload.className = 'text-btn small';
  reload.textContent = 'Reload to apply';
  reload.addEventListener('click', () => {
    const t = activeTab();
    if (!t) return;
    // Internal tabs are excluded by disabled button state; only web tabs reach here.
    if (!t.trusted && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
  });
  foot.appendChild(reload);
  s.appendChild(foot);

  return s;
}

function toggle(on, onChange, label) {
  const t = document.createElement('button');
  t.className = 'switch' + (on ? ' on' : '');
  t.setAttribute('role', 'switch');
  t.setAttribute('aria-checked', String(on));
  if (label) t.setAttribute('aria-label', label);
  t.addEventListener('click', () => onChange(!on));
  return t;
}

function pJar() {
  const tab = activeTab();
  const c = (tab && tab.container) || DEFAULT_CONTAINER;
  const s = document.createElement('div');
  s.className = 'privacy-section';
  s.innerHTML =
    `<div class="ps-title">Jar</div>` +
    `<div class="ps-main"><span class="cm-dot" style="background:${c.color}"></span> ${escapeHtml(c.name)}${c.burner ? ' · burner (evaporates on close)' : ''}</div>`;
  const row = document.createElement('div');
  row.className = 'privacy-buttons';
  const btn = document.createElement('button');
  btn.className = 'text-btn small';
  btn.textContent = 'New identity';
  btn.title = 'Wipe this jar (cookies + storage) and reroll the fingerprint';
  btn.addEventListener('click', newIdentity);
  row.appendChild(btn);
  s.appendChild(row);
  return s;
}

async function newIdentity() {
  const tab = activeTab();
  if (!tab) return;
  const res = await window.goldfinch.identityNew({ partition: tab.container.partition });
  if (res && res.ok) {
    toast('New identity', 'Jar wiped + fingerprint rerolled');
    // Internal tabs are excluded by the New Identity button's tab-scoped disable; only web tabs reach here.
    if (!tab.trusted && tab.wcId != null) window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'reload', args: [] });
  } else {
    toast('New identity failed', (res && res.error) || '');
  }
}

function renderPrivacy() {
  updatePrivacyBadge();
  if (els.privacyPanel.classList.contains('collapsed')) return;
  const tab = activeTab();
  const p = tab ? tab.privacy : null;
  const net = p && p.net;
  const body = els.privacyBody;
  body.innerHTML = '';

  // Shields controls
  body.appendChild(pShields());

  // Jar / identity
  body.appendChild(pJar());

  // Connection
  const internal = !!(tab && isInternalPageUrl(tab.url || ''));
  const secure = internal || (tab && /^https:/i.test(tab.url || ''));
  body.appendChild(
    pSection(
      'Connection',
      secure ? 'ok' : 'bad',
      internal ? 'Secure — Goldfinch page' : secure ? 'Secure — HTTPS' : 'Not secure — HTTP',
      net && net.mixedContent ? `${net.mixedContent} insecure (mixed-content) request(s)` : ''
    )
  );

  // Trackers — blocked vs allowed
  const trk = net ? net.trackers : { ads: [], analytics: [], social: [], other: [], count: 0, blocked: 0, allowed: 0 };
  const tLabel = trk.count ? `${trk.blocked} blocked · ${trk.allowed} allowed` : 'no trackers detected';
  const tSec = pBigStat('Trackers', trk.count, tLabel);
  for (const cat of ['ads', 'analytics', 'social', 'other']) {
    if (trk[cat] && trk[cat].length) tSec.appendChild(pGroupStatus(cat, trk[cat]));
  }
  body.appendChild(tSec);

  // Third-party domains
  const tpCount = net ? net.thirdPartyCount : 0;
  const tpSec = pBigStat('Third-party domains', tpCount, 'distinct domains contacted');
  if (net && net.thirdPartyList.length)
    tpSec.appendChild(pList(net.thirdPartyList.map((x) => `${x.domain} (${x.count})`)));
  body.appendChild(tpSec);

  // Cookies + storage
  const ck = p && p.cookies;
  const cSec = pSection('Cookies', '', ck ? `${ck.first} first-party · ${ck.third} third-party` : 'Loading…', '');
  const cBtns = document.createElement('div');
  cBtns.className = 'privacy-buttons';
  cBtns.appendChild(pButton('Clear third-party', () => clearCookies('third')));
  cBtns.appendChild(pButton('Clear all cookies', () => clearCookies('all')));
  cBtns.appendChild(pButton('Clear site storage', clearStorage));
  cSec.appendChild(cBtns);
  if (ck && ck.list.length)
    cSec.appendChild(pList(ck.list.slice(0, 50).map((c) => `[${c.third ? '3rd' : '1st'}] ${c.name} — ${c.domain}`)));
  body.appendChild(cSec);

  // Fingerprinting
  const fp = p ? p.fp : { canvas: 0, webgl: 0, audio: 0 };
  const fpTotal = fp.canvas + fp.webgl + fp.audio;
  const fpSec = pBigStat('Fingerprinting', fpTotal, fpTotal ? 'fingerprinting API calls' : 'none detected');
  if (fpTotal) {
    fpSec.appendChild(
      pList(
        [
          fp.canvas ? `Canvas reads: ${fp.canvas}` : null,
          fp.webgl ? `WebGL GPU probe: ${fp.webgl}` : null,
          fp.audio ? `AudioContext: ${fp.audio}` : null
        ].filter(Boolean)
      )
    );
  }
  body.appendChild(fpSec);

  // Permissions
  const perms = p ? p.permissions : [];
  const permSec = pSection('Permissions', '', perms.length ? `${perms.length} requested` : 'none requested', '');
  if (perms.length)
    permSec.appendChild(pList(perms.map((x) => `${x.granted ? 'granted' : 'denied'} — ${x.permission}`)));
  body.appendChild(permSec);
}

function pSection(title, tone, main, sub) {
  const s = document.createElement('div');
  s.className = 'privacy-section';
  s.innerHTML =
    `<div class="ps-title">${escapeHtml(title)}</div>` +
    `<div class="ps-main ${tone || ''}">${escapeHtml(main)}</div>` +
    (sub ? `<div class="ps-sub warn">${escapeHtml(sub)}</div>` : '');
  return s;
}
function pBigStat(title, num, label) {
  const s = document.createElement('div');
  s.className = 'privacy-section';
  s.innerHTML =
    `<div class="ps-title">${escapeHtml(title)}</div>` +
    `<div class="ps-big ${num ? 'hot' : ''}">${num}</div><div class="ps-sub">${escapeHtml(label)}</div>`;
  return s;
}
// Tracker list with a blocked/allowed status tag per domain.
function pGroupStatus(cat, entries) {
  const d = document.createElement('div');
  d.className = 'ps-group';
  d.innerHTML = `<div class="ps-cat">${escapeHtml(cat)} (${entries.length})</div>`;
  const list = document.createElement('div');
  list.className = 'ps-list';
  list.tabIndex = 0;   // scrollable region must be keyboard-focusable so it can be arrow-scrolled (a11y)
  for (const e of entries) {
    const item = document.createElement('div');
    item.className = 'ps-item status';
    item.innerHTML =
      `<span class="tag ${e.blocked ? 'blk' : 'allow'}">${e.blocked ? 'blocked' : 'allowed'}</span>` +
      `<span class="dom${e.blocked ? ' struck' : ''}">${escapeHtml(e.domain)}</span>`;
    list.appendChild(item);
  }
  d.appendChild(list);
  return d;
}
function pList(items) {
  const l = document.createElement('div');
  l.className = 'ps-list';
  l.tabIndex = 0;   // scrollable region must be keyboard-focusable so it can be arrow-scrolled (a11y)
  l.innerHTML = items.map((i) => `<div class="ps-item">${escapeHtml(i)}</div>`).join('');
  return l;
}
function pButton(label, fn) {
  const b = document.createElement('button');
  b.className = 'text-btn small';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

/* ------------------------------------------------------------------- toasts */

const toastEls = new Map(); // url -> element

function toast(title, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div>${escapeHtml(body || '')}</div>`;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), 5000);
  return el;
}

// A toast that stays until explicitly finished (used for batch downloads).
function persistentToast(title, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-body">${escapeHtml(body || '')}</div>`;
  els.toasts.appendChild(el);
  return el;
}

window.goldfinch.onDownloadProgress((d) => {
  if (bulk.active && bulk.urls.has(d.url)) return; // batch shows one aggregate toast
  let el = toastEls.get(d.url);
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-title">Downloading</div><div class="dl-name"></div><div class="bar"><span></span></div>`;
    els.toasts.appendChild(el);
    toastEls.set(d.url, el);
  }
  el.querySelector('.dl-name').textContent = d.filename;
  el.querySelector('.toast-title').textContent = d.paused ? 'Paused' : 'Downloading';
  const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
  el.querySelector('.bar > span').style.width = `${pct}%`;
});

window.goldfinch.onDownloadDone((d) => {
  if (bulk.active && bulk.urls.has(d.url)) {
    bulkComplete(d.url, d.state === 'completed');
    return;
  }
  const el = toastEls.get(d.url);
  toastEls.delete(d.url);
  if (el) el.remove();
  if (d.state === 'completed') {
    const t = toast('Downloaded', d.filename);
    const link = document.createElement('a');
    link.textContent = ' — Show in folder';
    link.addEventListener('click', () => window.goldfinch.showItemInFolder(d.savePath));
    t.appendChild(link);
  } else {
    toast('Download ' + d.state, d.filename);
  }
});

window.goldfinch.onOpenTab((url) => createTab(url));

/* --------------------------------------------------------------- shortcuts */

document.addEventListener('keydown', (e) => {
  // The pure decision — "given (key, mods, lightboxOpen), which action?" — lives in
  // keydownToAction (../shared/keydown-action.js, a bare global; same dual-export
  // route as isSafeTabUrl). It reproduces the live gating exactly: F12 before the
  // modifier gate, mod = ctrl||meta, zoom/find/F12/Ctrl+Shift+I lightbox-deferred,
  // the t/w/l/m/Shift+P/r chain not lightbox-gated, Ctrl+Shift+I vs Shift+P by key
  // letter. The IMPURE dispatch below (active-tab resolution, internal-tab / null-wcId
  // guards, preventDefault, IPC / DOM ops) stays here unchanged — behavior-preserving.
  const action = keydownToAction({
    key: e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    lightboxOpen: !els.lightbox.classList.contains('hidden'),
  });
  if (!action) return;

  switch (action) {
    // DevTools (F12 and Ctrl+Shift+I) — chrome-focused fallback (the page-focused case is
    // captured main-side in before-input-event). No-op on internal tabs / a tab with no live wcId.
    case 'devtools': {
      const t = activeTab();
      if (!t || isInternalTab(t) || t.wcId == null) return;
      e.preventDefault();
      window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
      return;
    }
    // Page-zoom fallback (DD6): route the active web tab's wcId to main.
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset': {
      const t = activeTab();
      if (!t || isInternalTab(t) || t.wcId == null) return;
      const zoom = (action === 'zoom-out') ? 'out' : (action === 'zoom-reset') ? 'reset' : 'in';
      e.preventDefault();
      window.goldfinch.zoomApply({ webContentsId: t.wcId, action: zoom });
      return;
    }
    // Chrome-focused Ctrl+F fallback (DD2 / AC2): no bar on internal tabs.
    case 'find': {
      const t = activeTab();
      if (!t || isInternalTab(t) || t.wcId == null) return;
      e.preventDefault();
      openFind(t);
      return;
    }
    case 'new-tab':
      e.preventDefault();
      createTab();
      return;
    case 'close-tab':
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
      return;
    case 'focus-address':
      e.preventDefault();
      els.address.focus();
      els.address.select();
      return;
    case 'toggle-panel':
      e.preventDefault();
      togglePanel();
      return;
    case 'toggle-privacy':
      e.preventDefault();
      togglePrivacy();
      return;
    case 'reload': {
      e.preventDefault();
      const t = activeTab();
      if (!t) return;
      // Internal tabs: reload keyboard shortcut is a no-op (internal pages are static).
      if (!t.trusted && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
      return;
    }
    // Downloads (Ctrl+J) — chrome-focused fallback (the page-focused case is captured main-side
    // in before-input-event → onOpenDownloads). No-op if the active tab is already internal so a
    // second internal tab isn't stacked (DD2).
    case 'downloads': {
      e.preventDefault();
      const t = activeTab();
      if (t && isInternalTab(t)) return;
      openDownloads();
      return;
    }
  }
});

/* --------------------------------------------------------- automation hook */

// Automation hook — chrome renderer ONLY (this file is the privileged app shell;
// it is never the preload for a guest webview, so web content cannot reach this).
// Thin wrappers over the existing tab ops; main drives these via executeJavaScript
// and applies the authoritative internal-session filter on its side (DD1/DD5).
//
// openTab uses a dom-ready RACE GUARD: createTab() calls activateTab()
// synchronously, and dom-ready can fire before this Promise body runs. We
// attach the listener first, then re-check tab.wcId immediately so a
// just-fired dom-ready is never missed into the timeout path.
const OPEN_TAB_TIMEOUT_MS = 5000;

// @ts-ignore — dynamic property on Window; intentional chrome-renderer-only automation hook (DD1/DD5)
window.__goldfinchAutomation = {
  listTabs() {
    return [...tabs.values()].map((t) => ({
      wcId: t.wcId,                      // null until dom-ready
      url: t.url,
      title: t.title,
      jarId: t.container ? t.container.id : null,
      active: t.id === activeTabId,
    }));
  },
  openTab(url, jarId) {
    let container = null;
    if (jarId != null) {
      container = containers.find((c) => c.id === jarId) || null;
      // Unknown jarId → REFUSE (DD3): do NOT silently fall back to DEFAULT_CONTAINER.
      if (!container) throw new Error('automation: unknown-jar — no container ' + jarId);
    }
    const tab = createTab(url, container);   // null container → createTab uses DEFAULT_CONTAINER (today's behavior)
    if (!tab) return null;               // URL rejected
    if (tab.wcId != null) return tab.wcId;
    // All tabs (web + internal) are WebContentsViews (Leg 3): wait for wcId to be set
    // via the tabCreate IPC promise resolving. The old trusted-webview dom-ready poll
    // branch is removed — internal tabs no longer have a <webview> element.
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (tab.wcId != null) { clearInterval(check); clearTimeout(timeout); resolve(tab.wcId); }
      }, 20);
      const timeout = setTimeout(() => { clearInterval(check); resolve(tab.wcId ?? null); }, OPEN_TAB_TIMEOUT_MS);
    });
  },
  closeTabByWcId(wcId) {
    const tab = findTabByWcId(wcId);
    if (!tab) return false;
    closeTab(tab.id);
    return true;
  },
  activateTabByWcId(wcId) {
    const tab = findTabByWcId(wcId);
    if (!tab) return false;
    activateTab(tab.id);
    return true;
  },
};

/* ------------------------------------------------------------------- helpers */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------- boot */
// ---------------------------------------------------------------------------
// Web tab event subscriptions (module-level, route by wcId to the correct tab)
// ---------------------------------------------------------------------------

window.goldfinch.onTabDidNavigate(({ wcId, url }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.url = url;
  if (tab.id === activeTabId) {
    els.address.value = tab.url;
    updateAddressChip(tab);
    updateNavButtons();
  }
  tab.media = [];
  tab.selected.clear();
  tab.privacy = blankPrivacy();
  if (tab.id === activeTabId) {
    renderMedia();
    renderPrivacy();
  }
  if (tab.findOpen) {
    tab.findOpen = false;
    window.goldfinch.tabFind({ wcId, stop: true, options: 'clearSelection' });
    if (tab.id === activeTabId) {
      els.findBar.classList.add('hidden');
      els.findCount.textContent = '';
      // Restore the guest's full bounds now that the find bar is hidden on navigate.
      sendActiveBounds();
    }
  }
});

window.goldfinch.onTabDidNavigateInPage(({ wcId, url }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.url = url;
  if (tab.id === activeTabId) {
    els.address.value = tab.url;
    updateAddressChip(tab);
    updateNavButtons();
  }
});

window.goldfinch.onTabTitle(({ wcId, title }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.title = title;
  tab.btn.querySelector('.tab-title').textContent = title || tab.url;
  tab.btn.title = title || '';
  const name = title || tab.url;
  tab.btn.setAttribute('aria-label', name);
  const close = tab.btn.querySelector('.tab-close');
  if (close) close.setAttribute('aria-label', `Close tab: ${name}`);
});

window.goldfinch.onTabFavicon(({ wcId, favicons }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  const fav = favicons && favicons[0];
  if (!fav) return;
  tab.favicon = fav;
  const img = /** @type {HTMLImageElement|null} */ (tab.btn.querySelector('.tab-fav'));
  if (img) { img.src = fav; img.classList.remove('hidden'); }
});

window.goldfinch.onTabLoading(({ wcId, loading }) => {
  const tab = findTabByWcId(wcId);
  if (!tab || tab.id !== activeTabId) return;
  if (loading) {
    els.reload.textContent = '✕';
    els.reload.setAttribute('aria-label', 'Stop');
    els.reload.title = 'Stop';
  } else {
    els.reload.textContent = '⟳';
    els.reload.setAttribute('aria-label', 'Reload');
    els.reload.title = 'Reload';
  }
});

window.goldfinch.onTabDidFinishLoad(({ wcId }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  if (tab.id === activeTabId) refreshZoomControl(tab);
});

window.goldfinch.onTabDomReady(({ wcId }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  updateNavButtons();
  if (tab.id === activeTabId) {
    refreshZoomControl(tab);
    if (!els.privacyPanel.classList.contains('collapsed')) {
      fetchCookies();
    }
  }
});

window.goldfinch.onTabMediaList(({ wcId, mediaList }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.media = mediaList || [];
  if (tab.id === activeTabId) renderMedia();
});

window.goldfinch.onTabFoundInPage(({ wcId, result }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  const { activeMatchOrdinal, matches } = result;
  if (tab.id === activeTabId && tab.findOpen) {
    els.findCount.textContent = matches ? `${activeMatchOrdinal}/${matches}` : '0/0';
  }
});

window.goldfinch.onTabPrivacyFp(({ wcId, fpCounts }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.privacy.fp = fpCounts || tab.privacy.fp;
  if (tab.id === activeTabId) renderPrivacy();
});

window.goldfinch.onTabNavState(({ wcId, canGoBack, canGoForward }) => {
  const tab = findTabByWcId(wcId);
  if (!tab || tab.id !== activeTabId) return;
  els.back.disabled = !canGoBack;
  els.forward.disabled = !canGoForward;
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
  if (guestFrozen) return;
  // Force a fresh measurement, bypassing the rAF coalescing guard.
  // Re-schedule a rAF-based send too for the settled-layout measurement.
  rafGeometryPending = false;  // cancel any pending rAF (it was reading stale bounds)
  sendActiveBounds();          // reschedule with fresh pending
});

// ---------------------------------------------------------------------------
// New container dialog: wire OK/Cancel at startup (runs once; elements are always present).
(function initNewContainerDialog() {
  const dialog = /** @type {HTMLElement|null} */ (document.getElementById('new-container-dialog'));
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('new-container-name'));
  const okBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('new-container-ok'));
  const cancelBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('new-container-cancel'));
  if (!dialog || !input || !okBtn || !cancelBtn) return;

  function closeDialog() {
    dialog.classList.add('hidden');
    input.value = '';
  }

  async function submitDialog() {
    const name = input.value.trim();
    if (!name) return;
    closeDialog();
    // Main creates the jar and returns the container object; renderer opens the tab directly.
    const c = await window.goldfinch.newContainerCreate(name);
    if (c) {
      containers.push(c);
      createTab(currentHomePage(), c);
    }
  }

  okBtn.addEventListener('click', () => submitDialog());
  cancelBtn.addEventListener('click', () => closeDialog());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitDialog(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
  });
  // Click outside the inner box to dismiss
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
})();

window.goldfinch.settingsGet('homePage').then((url) => createTab(url || HOMEPAGE)).catch(() => createTab(HOMEPAGE));
