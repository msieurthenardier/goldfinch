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
  siteInfoPopup: /** @type {HTMLElement} */ (document.getElementById('site-info-popup'))
};

// Tag <html> with the OS platform so window-chrome CSS can branch (mac native
// traffic lights vs. win/linux custom controls). Optional-chained so a non-preload
// load path never aborts init at the top level.
document.documentElement.classList.add(`platform-${window.goldfinch?.platform ?? 'unknown'}`);

/**
 * @typedef {{
 *   id: string,
 *   webview: Electron.WebviewTag,
 *   title: string,
 *   url: string,
 *   favicon: string | null,
 *   media: any[],
 *   selected: Set<string>,
 *   wcId: number | null,
 *   privacy: { net: any, fp: { canvas: number, webgl: number, audio: number }, permissions: any[], cookies: any },
 *   container: { id: string, name: string, color: string, partition: string, burner?: boolean },
 *   btn?: HTMLElement
 * }} Tab
 */

/** @type {Map<string, Tab>} */
const tabs = new Map();
let activeTabId = null;
let activeFilter = 'all';
let tabSeq = 0;

/* ------------------------------------------------------- shared menu controller */
// One in-file controller owns open/close + mutual-exclusion + outside-dismiss for
// every dropdown menu (kebab overflow, container picker). Each menu registers an
// entry whose `onOpen`/`onClose` are its RAW show/hide bodies — never the public
// `closeX` wrapper (the wrapper delegates back into the controller, so reusing it
// as `onClose` would recurse: close → onClose → closeX → close → …). The public
// wrapper and the raw `onClose` are deliberately two distinct functions.

/**
 * @typedef {{
 *   trigger: HTMLElement,
 *   menu: HTMLElement,
 *   items?: () => HTMLElement[],
 *   onOpen?: (startIndex?: number) => void,
 *   onClose?: () => void
 * }} MenuEntry
 */

const menuController = (() => {
  /** @type {MenuEntry[]} */
  const entries = [];
  /** @type {MenuEntry|null} */
  let open = null; // currently-open entry or null
  /** @param {MenuEntry} entry @param {number} [startIndex] */
  function openEntry(entry, startIndex = 0) {
    closeAll(); // mutual-exclusion: opening one menu dismisses any other
    entry.onOpen?.(startIndex); // menu-specific: build items, show, position, focus, aria
    open = entry;
  }
  /** @param {MenuEntry} entry */
  function closeEntry(entry) {
    entry.onClose?.(); // raw hide body — NOT the public wrapper (avoids recursion)
    if (open === entry) open = null;
  }
  function closeAll() {
    if (open) closeEntry(open);
  }
  /** @param {MenuEntry} entry @returns {MenuEntry} */
  function register(entry) {
    entries.push(entry);

    // Controller-level trigger keydown: Enter/Space/ArrowDown → open to first item;
    // ArrowUp → open to last item (APG menu-button). preventDefault suppresses the
    // synthetic click so the menu opens exactly once.
    entry.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openEntry(entry, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        openEntry(entry, -1);
      }
    });

    // Controller-level menu keydown: full APG roving-tabindex contract.
    // Guard `if (!entry.items) return` so a non-menu popup consumer (e.g. the
    // site-info popup in leg 5) can register without an items-getter and the
    // roving/arrow contract simply no-ops for it.
    entry.menu.addEventListener('keydown', (e) => {
      if (!entry.items) return;
      const items = entry.items();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEntry(entry);
        entry.trigger.focus();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeEntry(entry);
        entry.trigger.focus(); // Tab/Shift+Tab close the menu and return focus to the trigger
      } else {
        // Arrow/Home/End require items; guard before calling focusItem (wrap formula
        // NaN-s on an empty list — cheap safety net even though an open menu always has items).
        if (!items.length) return;
        const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusItem(items, idx + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          focusItem(items, idx - 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          focusItem(items, 0);
        } else if (e.key === 'End') {
          e.preventDefault();
          focusItem(items, items.length - 1);
        }
      }
    });

    return entry;
  }
  return {
    register,
    open: openEntry,
    close: closeEntry,
    closeAll,
    get current() {
      return open;
    }
  };
})();

// Target-aware outside-dismiss for all registered menus. pointerdown fires before
// focus shifts, and the menu-dismissal CDP clicks dispatch pointerdown→click, so
// this catches in-chrome clicks (address bar, neutral chrome). A click inside the
// open menu or on its own trigger is ignored (item handlers / the trigger's own
// toggle do their thing); a click on the OTHER trigger is handled by that trigger's
// open() (which closeAll()s first). Outside-dismiss does NOT restore focus to the
// trigger — only Escape/Tab do that.
document.addEventListener('pointerdown', (e) => {
  const cur = menuController.current;
  if (!cur) return;
  const t = /** @type {Node} */ (e.target);
  if (cur.menu.contains(t) || cur.trigger.contains(t)) return;
  menuController.closeAll();
});
// Page/webview clicks (a separate web-contents the chrome document can't see) and
// app-switch both fire window blur → close any open menu (DD1, spike-confirmed).
window.addEventListener('blur', () => menuController.closeAll());

/* ----------------------------------------------------- jars / containers */

const DEFAULT_CONTAINER = { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' };
let containers = [DEFAULT_CONTAINER];
window.goldfinch.jarsList().then((list) => {
  if (list && list.length) containers = list;
});

function makeBurner() {
  const n = Math.floor(Math.random() * 1e9);
  return { id: `burner-${n}`, name: 'Burner', color: '#ff8c42', partition: `burner:${n}`, burner: true };
}

/** @returns {HTMLElement[]} */
function containerItems() {
  return /** @type {HTMLElement[]} */ ([...els.containerMenu.querySelectorAll('[role="menuitem"]')]);
}
// Container picker registered with the controller (open/close/dismissal/mutual-
// exclusion). `onOpen(startIndex)` builds + shows + anchors + applies roving/focus;
// `onClose` is the raw hide body. Full APG roles/keyboard nav (mirrors the kebab).
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
    add.addEventListener('click', addContainer);
    m.appendChild(add);
    m.classList.remove('hidden');
    // Anchor the menu under the pill's ▾ trigger; the pill now moves with the tab count.
    m.style.left = els.newTabMenu.getBoundingClientRect().left + 'px';
    els.newTabMenu.setAttribute('aria-expanded', 'true');
    // Apply roving tabindex + focus via the shared helper (items rebuilt every open).
    const items = containerItems();
    focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
  },
  onClose() {
    els.containerMenu.classList.add('hidden');
    els.newTabMenu.setAttribute('aria-expanded', 'false');
  }
});
// Thin public wrapper — delegates to the controller. DISTINCT from `onClose` above
// (the raw hide body); never let these two collapse into one or `close` recurses.
function closeContainerMenu() {
  menuController.close(containerEntry);
}
async function addContainer() {
  const name = window.prompt('New container name:');
  if (!name) return;
  const c = await window.goldfinch.jarsAdd({ name });
  containers.push(c);
  closeContainerMenu();
  createTab(currentHomePage(), c);
}

/* ------------------------------------------------------- kebab (overflow) menu */
// APG menu-button: role="menu" popup with two static role="menuitem" items
// (Settings, Exit) + roving tabindex + arrow-nav. Open/close/dismissal/mutual-
// exclusion and the APG keyboard contract (trigger keydown + menu keydown) are all
// owned by the shared menuController (hoisted in leg 1, DD7).

/** @returns {HTMLElement[]} */
function kebabItems() {
  return /** @type {HTMLElement[]} */ ([...els.kebabMenu.querySelectorAll('[role="menuitem"]')]);
}
/** @param {HTMLElement[]} items @param {number} i */
function focusItem(items, i) {
  const n = ((i % items.length) + items.length) % items.length; // wrap, handles negatives
  items.forEach((el, j) => (el.tabIndex = j === n ? 0 : -1)); // roving tabindex
  items[n].focus();
}
function positionKebabMenu() {
  const r = els.kebab.getBoundingClientRect();
  els.kebabMenu.style.top = r.bottom + 4 + 'px';
  els.kebabMenu.style.right = window.innerWidth - r.right + 'px';
  els.kebabMenu.style.left = 'auto';
}
// Kebab registered with the controller. `onOpen(startIndex)` is the raw show body
// (show, position, aria, focus an item); `onClose` is the raw hide body. The public
// `closeKebabMenu` below is a DISTINCT thin wrapper (delegates to the controller).
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
  },
  onClose() {
    els.kebabMenu.classList.add('hidden');
    els.kebab.setAttribute('aria-expanded', 'false');
  }
});
// Thin public wrapper — delegates to the controller. DISTINCT from `onClose` above.
function closeKebabMenu() {
  menuController.close(kebabEntry);
}

// Activation: native click on the focused <button> menuitem fires these.
els.kebabMenu.querySelector('#kebab-settings')?.addEventListener('click', () => {
  closeKebabMenu();
  createTab('goldfinch://settings', null, { trusted: true });
});
els.kebabMenu.querySelector('#kebab-exit')?.addEventListener('click', () => {
  closeKebabMenu();
  window.goldfinch.appQuit();
});

els.kebab.addEventListener('click', () => {
  // Toggle off the controller's current (single source of truth), not the DOM class.
  if (menuController.current === kebabEntry) menuController.close(kebabEntry);
  else menuController.open(kebabEntry, 0);
});

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
      if (existing) {
        existing.webview.loadURL('goldfinch://settings/#privacy').catch(() => {});
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
  },
  onClose() {
    els.siteInfoPopup.classList.add('hidden');
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

  const webview = /** @type {Electron.WebviewTag} */ (document.createElement('webview'));
  webview.id = `webview-${id}`;
  webview.setAttribute('src', url);
  webview.setAttribute('preload', trusted ? window.goldfinch.internalPreloadPath : window.goldfinch.webviewPreloadPath);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('partition', jar.partition);
  webview.classList.add('hidden');
  els.webviews.appendChild(webview);

  const tab = {
    id,
    webview,
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
  btn.setAttribute('aria-controls', `webview-${id}`);
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

  wireWebview(tab);
  activateTab(id);
  return tab;
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.webview.remove();
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
    t.webview.classList.toggle('hidden', !isActive);
    t.btn.classList.toggle('active', isActive);
    t.btn.setAttribute('aria-selected', String(isActive));
    t.btn.tabIndex = isActive ? 0 : -1;
  }
  els.address.value = tab.url || '';
  updateAddressChip(tab);
  renderMedia();
  renderPrivacy();
  updateNavButtons();
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

/* ----------------------------------------------------------- webview wiring */

function wireWebview(tab) {
  const wv = tab.webview;

  wv.addEventListener('dom-ready', () => {
    try {
      tab.wcId = wv.getWebContentsId();
    } catch {
      /* not ready */
    }
    updateNavButtons();
    // If the Shields panel was opened before this webview's dom-ready, tab.wcId was
    // null when fetchCookies() first ran (it early-returns on null wcId), leaving the
    // Cookies section stuck on "Loading…". Now that wcId is set, fetch them.
    if (tab.id === activeTabId && !els.privacyPanel.classList.contains('collapsed')) {
      fetchCookies();
    }
  });

  wv.addEventListener('did-start-loading', () => {
    if (tab.id === activeTabId) {
      els.reload.textContent = '✕';
      els.reload.setAttribute('aria-label', 'Stop');
      els.reload.title = 'Stop';
    }
  });
  wv.addEventListener('did-stop-loading', () => {
    if (tab.id === activeTabId) {
      els.reload.textContent = '⟳';
      els.reload.setAttribute('aria-label', 'Reload');
      els.reload.title = 'Reload';
    }
  });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    tab.btn.querySelector('.tab-title').textContent = e.title || tab.url;
    tab.btn.title = e.title || '';
    const name = e.title || tab.url;
    tab.btn.setAttribute('aria-label', name);
    const close = /** @type {HTMLButtonElement|null} */ (tab.btn.querySelector('.tab-close'));
    if (close) close.setAttribute('aria-label', `Close tab: ${name}`);
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    const fav = e.favicons && e.favicons[0];
    if (!fav) return;
    tab.favicon = fav;
    const img = tab.btn.querySelector('.tab-fav');
    img.src = fav;
    img.classList.remove('hidden');
  });

  const onNav = () => {
    tab.url = wv.getURL();
    if (tab.id === activeTabId) {
      els.address.value = tab.url;
      updateAddressChip(tab);
      updateNavButtons();
    }
    // Reset media + selection + privacy on full navigation; preload/main re-populate.
    tab.media = [];
    tab.selected.clear();
    tab.privacy = blankPrivacy();
    if (tab.id === activeTabId) {
      renderMedia();
      renderPrivacy();
    }
  };
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', () => {
    tab.url = wv.getURL();
    if (tab.id === activeTabId) {
      els.address.value = tab.url;
      updateAddressChip(tab);
      updateNavButtons();
    }
  });

  // Media catalog + privacy signals streamed up from the webview preload.
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'media-list') {
      tab.media = e.args[0] || [];
      if (tab.id === activeTabId) renderMedia();
    } else if (e.channel === 'privacy-fp') {
      tab.privacy.fp = e.args[0] || tab.privacy.fp;
      if (tab.id === activeTabId) renderPrivacy();
    }
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // aborted (normal during fast nav)
  });
}

function updateNavButtons() {
  const tab = activeTab();
  const wv = tab && tab.webview;
  let canBack = false,
    canFwd = false;
  try {
    canBack = wv && wv.canGoBack();
    canFwd = wv && wv.canGoForward();
  } catch {
    /* not ready */
  }
  els.back.disabled = !canBack;
  els.forward.disabled = !canFwd;
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
  tab.webview.loadURL(url).catch(() => tab.webview.setAttribute('src', url));
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
  try {
    t.webview.goBack();
  } catch {
    /* webview not ready */
  }
});
els.forward.addEventListener('click', () => {
  const t = activeTab();
  try {
    t.webview.goForward();
  } catch {
    /* webview not ready */
  }
});
els.reload.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  if (els.reload.textContent === '✕') t.webview.stop();
  else t.webview.reload();
});
els.newTab.addEventListener('click', () => createTab());
els.newTabMenu.addEventListener('click', () => {
  // Toggle off the controller's current (single source of truth), not the DOM class.
  if (menuController.current === containerEntry) menuController.close(containerEntry);
  else menuController.open(containerEntry);
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
els.toggleMedia.addEventListener('click', () => togglePanel());
els.toggleMedia.addEventListener('contextmenu', (e) => { e.preventDefault(); window.goldfinch.toolbarContextMenu('media'); });
els.mediaClose.addEventListener('click', () => togglePanel(false));
// Non-modal: Escape closes the media panel; togglePanel restores focus to the toggle.
els.panel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePanel(false);
  }
});
els.mediaRescan.addEventListener('click', () => {
  const t = activeTab();
  if (t && t.wcId != null) {
    try {
      t.webview.send('rescan-media');
    } catch {
      /* webview not ready */
    }
  }
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

els.togglePrivacy.addEventListener('click', () => togglePrivacy());
els.togglePrivacy.addEventListener('contextmenu', (e) => { e.preventDefault(); window.goldfinch.toolbarContextMenu('shields'); });
els.privacyClose.addEventListener('click', () => togglePrivacy(false));
// Non-modal: Escape closes the privacy panel; togglePrivacy restores focus to the toggle.
els.privacyPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePrivacy(false);
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
/**
 * Show or hide the Media/Shields toolbar icons per the current pin state.
 * Unpinned → button hidden (`.hidden`); keyboard shortcuts remain active.
 * @param {{ media: boolean, shields: boolean }} pins
 */
function applyToolbarPins(pins) {
  els.toggleMedia.classList.toggle('hidden', !pins.media);
  els.togglePrivacy.classList.toggle('hidden', !pins.shields);
}

window.goldfinch.settingsGet('toolbarPins').then(applyToolbarPins).catch(() => {});

window.goldfinch.onSettingsChanged((all) => {
  if (all && all.homePage !== undefined) homePageCache = all.homePage || HOMEPAGE;
  if (all && all.toolbarPins) applyToolbarPins(all.toolbarPins);
});

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
    if (t) t.webview.reload();
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
    tab.webview.reload();
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
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  if (e.key === 't') {
    e.preventDefault();
    createTab();
  } else if (e.key === 'w') {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  } else if (e.key === 'l') {
    e.preventDefault();
    els.address.focus();
    els.address.select();
  } else if (e.key === 'm') {
    e.preventDefault();
    togglePanel();
  } else if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    togglePrivacy();
  } else if (e.key === 'r') {
    e.preventDefault();
    const t = activeTab();
    if (t) t.webview.reload();
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
  openTab(url) {
    const tab = createTab(url);          // untrusted branch → isSafeTabUrl enforced
    if (!tab) return null;               // URL rejected
    if (tab.wcId != null) return tab.wcId;
    // wcId is assigned at dom-ready; resolve once it lands (bounded wait).
    return new Promise((resolve) => {
      const wv = tab.webview;
      const onReady = () => { wv.removeEventListener('dom-ready', onReady); resolve(tab.wcId ?? null); };
      wv.addEventListener('dom-ready', onReady);
      if (tab.wcId != null) { wv.removeEventListener('dom-ready', onReady); resolve(tab.wcId); return; }
      setTimeout(() => { wv.removeEventListener('dom-ready', onReady); resolve(tab.wcId ?? null); }, OPEN_TAB_TIMEOUT_MS);
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
window.goldfinch.settingsGet('homePage').then((url) => createTab(url || HOMEPAGE)).catch(() => createTab(HOMEPAGE));
