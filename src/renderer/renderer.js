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
 *   webview: Electron.WebviewTag,
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
// APG menu-button: role="menu" popup with four static role="menuitem" items
// (Settings, Downloads, Print…, Exit) + roving tabindex + arrow-nav. Open/close/dismissal/mutual-
// exclusion and the APG keyboard contract (trigger keydown + menu keydown) are all
// owned by the shared menuController (hoisted in leg 1, DD7).

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

// Shared open path for downloads (DD2): kebab click + both Ctrl+J paths converge here.
function openDownloads() {
  createTab('goldfinch://downloads', null, { trusted: true });
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

/* ------------------------------------------------- page context menu (SC6/DD2/DD3) */
// The custom web-content context menu, rendered via the menuController as its 4th consumer
// (registered IN PLACE — NOT graduated, DD3). It subscribes to the Leg-1 onPageContextMenu IPC
// ({ wcId, params }) forwarded from the guest's main-side context-menu listener (internal
// goldfinch:// guests auto-excluded main-side, DD6 — so no renderer-side internal gate is needed).
// Items are built per-invocation from the forwarded params (like the container picker); the menu
// opens at the cursor position and supplies focus-return via the additive focusReturn? option.

/** @returns {HTMLElement[]} */
function pageContextItems() {
  return /** @type {HTMLElement[]} */ ([...els.pageContextMenu.querySelectorAll('[role="menuitem"]')]);
}

// Module-scoped state: the LAST forwarded { wcId, params }, the cursor coords to open at, and the
// focus-return target captured at open. Acted-on wcId is the one captured at right-click (TOCTOU —
// never re-resolved via activeTab() for dispatch). `keyboard` marks a chrome-focused Shift+F10/
// ContextMenu invocation (vs. a guest right-click) so focus-return branches correctly.
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
 * A target may match several sections (e.g. a linked image, or an editable field with a
 * selection) — every applicable section is included, in order, with a separator between groups;
 * Inspect is always last. Edit items are OMITTED when their editFlags flag is falsy (kept out of
 * the roving set) — render-only-if-truthy, never disabled. Caller shows the node before measuring.
 * In toolbar-mode (ctx.toolbarItem set) it short-circuits to a single "Unpin {item}" item (Leg 5).
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

  // --- toolbar-mode: single "Unpin {item}" item (Leg 5) — short-circuit; no page sections. ---
  if (ctx.toolbarItem) {
    const itm = ctx.toolbarItem;            // capture: ctx.toolbarItem may be reset before the click fires
    const label = 'Unpin ' + (itm === 'media' ? 'Media'
      : itm === 'shields' ? 'Shields' : 'DevTools');
    // Reuse the existing item(label, onClick) helper so the menuitem markup, cm-item class, role,
    // textContent, and close-then-act wiring are IDENTICAL to the page-menu items.
    item(label, () => {
      window.goldfinch.unpinToolbarItem(itm);
      // FOCUS FIX (design-review HIGH): unpinning HIDES the button this menu was anchored to, so the
      // close-path focus-return (onClose → button.focus()) would focus an about-to-be-hidden element
      // and strand focus on <body>. Route focus to the address bar explicitly here, in the action,
      // AFTER the unpin send. Runs on both the mouse and keyboard close paths.
      els.address.focus();
    });
    return;  // toolbar-mode is single-item: no page sections, no Inspect
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

  // --- spelling suggestions (Leg-2 spellcheck ON populates these on the guest event) ---
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
 * Position the menu at the cursor. params.x/y arrive as chrome-WINDOW client coordinates: the guest
 * <webview> context-menu params are reported relative to the embedder window, not the webview content
 * (HAT-verified — adding the webview's top offset double-counted it and dropped the menu ~toolbar-height
 * too low). The keyboard-anchored invocations (Shift+F10 / toolbar Unpin) likewise pass chrome-client
 * coords derived from an element's getBoundingClientRect(). So NO webview-rect offset is applied; just
 * clamp inside the viewport. Measure after the node is shown (real offsetWidth/offsetHeight).
 */
function positionPageContextMenu(px, py) {
  const m = els.pageContextMenu;
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  let x = Math.min(px, window.innerWidth - mw - 4);   // clamp right edge
  let y = Math.min(py, window.innerHeight - mh - 4);  // clamp bottom edge
  m.style.left = Math.max(4, x) + 'px';
  m.style.top = Math.max(4, y) + 'px';
  m.style.right = 'auto';
}

const pageContextEntry = menuController.register({
  // No persistent trigger button — the menu node is its own `trigger` purely so the controller's
  // trigger-keydown wiring has a target (it is harmless here: a hidden menu never receives the
  // open chord). Focus-return goes through `focusReturn` (step 3a), NOT entry.trigger.focus().
  trigger: els.pageContextMenu,
  menu: els.pageContextMenu,
  items: pageContextItems,
  /** @param {number} [startIndex] index to focus on open (default 0; -1 = last) */
  onOpen(startIndex = 0) {
    buildPageContextSections(pageCtx);
    els.pageContextMenu.classList.remove('hidden');
    // Defensive blur-race mitigation (step 0): pull focus to the chrome menu node so the chrome
    // window is focused while the menu is up. Verified harmless — the WSLg ordering has the guest
    // right-click's window blur fire ~26ms BEFORE the page-context-menu IPC arrives (so closeAll
    // runs on an empty controller, before open()), but self-focus + the microtask-deferred open in
    // the subscription guard against a different ordering on other platforms.
    els.pageContextMenu.focus();   // focus the CONTAINER (tabindex=-1) — captures keyboard, no item
    positionPageContextMenu(pageCtx.x, pageCtx.y);
    const items = pageContextItems();
    // MOUSE (right-click) open: leave focus on the container so NO item is highlighted (deterministic
    // — :focus styling needs a focused item). ArrowDown then roves to the first item via the menu
    // keydown handler (idx -1 → 0). KEYBOARD invocations (Shift+F10 / toolbar Unpin) focus the first/
    // last item immediately per the APG menu contract.
    if (pageCtx.keyboard && items.length) {
      focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
    }
  },
  onClose() {
    els.pageContextMenu.classList.add('hidden');
    const ret = pageCtx.returnFocus;
    pageCtx.returnFocus = null;
    if (ret && typeof ret.focus === 'function') ret.focus();
  },
  // Focus-return (delivered via the additive option, NOT entry.trigger.focus() — which would
  // strand focus on the hidden menu node). Branch on invocation source: a guest right-click /
  // in-page ContextMenu returns focus to the active <webview> (back to where the user was working;
  // document.activeElement is the chrome <body>/webview, not a useful target); a chrome-focused
  // Shift+F10 returns to the captured activeElement. Fall back to els.address. Never the hidden node.
  focusReturn() {
    const ret = pageCtx.returnFocus;
    pageCtx.returnFocus = null;
    if (!pageCtx.keyboard) {
      const wv = activeTab() && activeTab().webview;
      if (wv && typeof wv.focus === 'function') { wv.focus(); return; }
    }
    if (ret && ret !== document.body && typeof ret.focus === 'function') { ret.focus(); return; }
    els.address.focus();
  }
});
// Thin public wrapper — delegates to the controller. DISTINCT from onClose above.
function closePageContextMenu() {
  menuController.close(pageContextEntry);
}

// Subscription: the guest right-click flows guest -> main -> this IPC ({ wcId, params }). Store
// state, capture coords + focus-return, then open. The open is deferred to a microtask so any
// chrome `window` blur from the right-click (which closeAll()s menus, renderer.js blur listener)
// has settled before open() runs — defensive against the step-0 blur race (observed NOT to bite on
// WSLg, where blur precedes the IPC, but harmless and platform-robust). menuController.open
// closeAll()s first, so a second right-click re-opens with fresh params.
window.goldfinch.onPageContextMenu(({ wcId, params }) => {
  pageCtx.wcId = wcId;
  pageCtx.params = params;
  pageCtx.x = (params && typeof params.x === 'number') ? params.x : 0;
  pageCtx.y = (params && typeof params.y === 'number') ? params.y : 0;
  pageCtx.keyboard = false;
  pageCtx.toolbarItem = null;              // page-content mode — never leak a stale toolbar Unpin
  // Guest right-click: activeElement is the chrome <body>/webview, not a useful return target —
  // focusReturn() will route to the webview. Capture anyway for completeness.
  pageCtx.returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  queueMicrotask(() => menuController.open(pageContextEntry, 0));
});

// Shift+F10 / ContextMenu key — menu-specific invocation, wired HERE (NOT in the Leg-3
// keydownToAction mapper, DD5). FINDING (recorded for the flight log): when focus is INSIDE the
// guest <webview>, Chromium synthesizes a real `context-menu` event on the guest webContents for
// both Shift+F10 and the ContextMenu key — that flows through Leg-1's main-side listener and the
// onPageContextMenu subscription above exactly like a right-click (with real params + caret-derived
// x/y), so the in-page case needs NO synthetic handling here. This chrome-side handler therefore
// only covers the CHROME-focused case (focus on a toolbar/chrome element), where no guest event
// fires: derive x/y from the focused element's rect and open a minimal (Inspect-only, plus any
// last params) menu anchored there. Guarded so it never double-fires when the event originated in
// the guest (those don't bubble to the chrome document anyway — the webview is a separate contents).
document.addEventListener('keydown', (e) => {
  const isContextKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
  if (!isContextKey) return;
  // Don't hijack the address bar / find input / a text field's own context affordance, and don't
  // fight the lightbox modal. Only act for a genuine chrome-element focus.
  if (!els.lightbox.classList.contains('hidden')) return;
  const target = /** @type {HTMLElement|null} */ (document.activeElement);
  if (!target || target === document.body) return;
  // Gate (Leg 5): a focused toolbar pin button + ContextMenu key double-fires deterministically
  // (both a `contextmenu` event AND this keydown reach their listeners). The toolbar `contextmenu`
  // listener already opens the toolbar Unpin menu; return early here so only that path opens.
  if (target === els.toggleMedia || target === els.togglePrivacy || target === els.toggleDevtools) return;
  e.preventDefault();
  const r = target.getBoundingClientRect();
  pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
  // A chrome-focused invocation has no fresh guest params → an Inspect-only minimal menu on the
  // active web tab. (params null → buildPageContextSections renders just Inspect.)
  pageCtx.params = null;
  pageCtx.x = Math.round(r.left);
  pageCtx.y = Math.round(r.bottom);
  pageCtx.keyboard = true;                 // chrome client coords; skip the webview offset
  pageCtx.toolbarItem = null;              // page-content mode — never leak a stale toolbar Unpin
  pageCtx.returnFocus = target;            // return to the chrome element on close
  menuController.open(pageContextEntry, 0);
});

/**
 * Toolbar-mode invocation of the page context menu: a single "Unpin {item}" item anchored at the
 * right-clicked toolbar button. Reuses the Leg-4 component (pageContextEntry / positioning / keyboard
 * contract / focus-return) — no second menu, no second registration.
 * @param {'media'|'shields'|'devtools'} item
 * @param {HTMLElement} anchorEl  the toolbar button right-clicked
 */
function openToolbarContextMenu(item, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  pageCtx.toolbarItem = item;
  pageCtx.params = null;
  pageCtx.wcId = null;                 // toolbar Unpin needs no guest wcId (chrome-only write)
  pageCtx.x = Math.round(r.left);      // chrome client coords (keyboard-mode skips the webview offset)
  pageCtx.y = Math.round(r.bottom);    // open just below the button
  pageCtx.keyboard = true;             // positionPageContextMenu treats x/y as chrome client coords
  pageCtx.returnFocus = anchorEl;      // focusReturn() returns to the button (keyboard-mode branch)
  menuController.open(pageContextEntry, 0);
}

/**
 * Test/audit hook (Leg 6): open the page context menu with a representative synthetic params payload so
 * the `npm run a11y` harness — which cannot fire a guest `context-menu` event, and for which the menu's
 * real open path is gated behind the unreachable `const pageCtx`/`pageContextEntry`/`menuController`
 * (classic-script `const`s are NOT main-world globals; only top-level `function` declarations are) — can
 * audit the open `#page-context-menu`. Builds a full-section menu (link + selection + editable +
 * spelling-suggestions + Inspect) at a fixed chrome coord. NOT wired to any UI; reachable in the guest
 * main world by the MCP `evaluate`/`injectScript` tools (top-level `function` ⇒ `window` global).
 */
// Reachable ONLY at runtime via the MCP eval tool (the a11y harness), never called in-tree by design,
// so eslint's no-unused-vars cannot see a reference — it IS a live entry point, not dead code.
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
  pageCtx.keyboard = true;       // treat x/y as chrome client coords (skip the webview offset)
  pageCtx.toolbarItem = null;    // page-content mode (full sections, not the single Unpin item)
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
  refreshZoomControl(tab);
  // Per-tab find restore (AC8 / DD3). Re-show the bar and re-issue findInPage so
  // the live count refreshes (intent only was cached; counts are always live-queried).
  // Tabs without findOpen stay hidden — new tabs have findOpen falsy, safe no-op.
  if (tab.findOpen && !isInternalTab(tab)) {
    els.findBar.classList.remove('hidden');
    els.findInput.value = tab.findText || '';
    runFind(tab, { findNext: false });
  } else {
    els.findBar.classList.add('hidden');
    els.findCount.textContent = '';
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
    // On the active tab, mount the in-bar zoom control into its faded-but-hoverable
    // steady state now that wcId is live. activateTab() ran at createTab() time with
    // tab.wcId still null (refreshZoomControl early-returns to .hidden then), so without
    // this the control stays display:none — and thus un-hoverable — until the first
    // zoom-changed event. Refresh here so address-bar hover reveals it from initial load.
    if (tab.id === activeTabId) refreshZoomControl(tab);
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
    // Find invalidation on did-navigate (AC9 / DD3). A new document means the previous
    // query is stale and the highlight is gone. Always clear intent + stop the engine,
    // but only hide the DOM bar when this tab is the active one — did-navigate can fire
    // on a backgrounded tab whose state still needs resetting.
    if (tab.findOpen) {
      tab.findOpen = false;
      try { wv.stopFindInPage('clearSelection'); } catch { /* webview gone */ }
      if (tab.id === activeTabId) {
        els.findBar.classList.add('hidden');
        els.findCount.textContent = '';
      }
    }
  };
  wv.addEventListener('did-navigate', onNav);
  // Re-query the zoom label once the load settles. Under Chromium's per-origin host-zoom
  // map (DD1), committing/navigating to an origin that already has a non-100% level
  // applies that zoom IMPLICITLY (no zoom-changed fires). dom-ready may run before the
  // host-zoom level is applied; did-finish-load fires after the main-frame load completes,
  // so getZoom() reflects the inherited factor. This replaces the prior main-side
  // did-finish-load → zoom-changed broadcast — one mechanism, the renderer query.
  wv.addEventListener('did-finish-load', () => {
    if (tab.id === activeTabId) refreshZoomControl(tab);
  });
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

  // Found-in-page result stream (SC4 / DD1 / DD3).
  // Attached per-webview so a backgrounded tab's late finalUpdate is not lost.
  // Repaint guards (AC10 / DD3):
  //   1. tab.id === activeTabId  — race-guard (mirrors refreshZoomControl)
  //   2. tab.findOpen            — no-flash guard: a trailing matches:0 after
  //      stopFindInPage must not paint "0/0" into a just-closed bar.
  wv.addEventListener('found-in-page', (e) => {
    const { activeMatchOrdinal, matches } = e.result;
    // Always keep the tab's UI intent current (the cache is intent, not a count).
    // Repaint only when this tab is active AND the bar is logically open.
    if (tab.id === activeTabId && tab.findOpen) {
      els.findCount.textContent = matches ? `${activeMatchOrdinal}/${matches}` : '0/0';
    }
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
  tab.webview.loadURL(url).catch((err) => {
    // Do NOT re-navigate on failure. A navigation that converts into a download rejects
    // with ERR_FAILED/ERR_ABORTED; re-issuing (incl. via the src attribute, which calls
    // loadURL internally) re-triggers the download → duplicate DownloadItem. navigate() is
    // only ever called from the address bar on a ready webview (createTab does the initial
    // load via the src attribute), so there is no not-ready race to recover here.
    // did-fail-load surfaces genuine load errors to the user.
    console.warn('[navigate] loadURL rejected:', err && (err.code || err.message || err));
  });
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

/* ----------------------------------------------------- shared panel slide (#27/DD1) */

// Both right-side panels (#media-panel, #privacy-panel) slide via a compositor-owned
// `transform` transition (styles.css), NOT an animated width/margin — so opening or
// closing never reflows #webviews or the chrome above per frame (#27, DD1 Prong A).
// The layout box (width) is swapped DISCRETELY here, synchronized to the transform:
// open before the slide-in, released to 0 on the slide-out's transitionend. Every
// collapse/expand call site routes through this one helper (AC11) so the box is
// always released at rest — including the mutual-exclusion cross-panel switch.
//
// Frame ordering (AC11, design-review [medium]):
//   Open:  width := --panel-w (still .collapsed → 360px wide AND translated off-screen)
//          → force reflow read → next rAF: remove .collapsed → only transform animates in.
//   Close: add .collapsed (transform animates out) → on transitionend (or fallback
//          timeout): width := 0 to release the box, re-reading live intended state.
const SLIDE_MS = 180; // matches the `transform 0.18s` transition in styles.css
const slideState = new WeakMap(); // el -> { timer, onEnd } so a new toggle cancels a stale one

/**
 * Drive a right-side panel's open/close: owns ONLY the width/transform/transitionend
 * mechanism. Callers keep their own aria/.active/focus/.hidden logic.
 * @param {HTMLElement} el panel element
 * @param {boolean} show true = open (slide in), false = close (slide out)
 * @param {{ beforeReveal?: () => void }} [opts] beforeReveal runs in the pre-paint
 *   window (width set, .collapsed still present) before the slide-in rAF — used by the
 *   privacy open path to populate content before it is visible (AC7, Prong B handoff).
 */
function slidePanel(el, show, opts) {
  // Cancel any in-flight transitionend/fallback from a previous toggle so a stale
  // close can't release width under a freshly-opened panel (AC11 guard iii).
  const prev = slideState.get(el);
  if (prev) {
    if (prev.timer) clearTimeout(prev.timer);
    if (prev.onEnd) el.removeEventListener('transitionend', prev.onEnd);
    slideState.delete(el);
  }

  if (show) {
    // 1) Give the panel its open layout box while still translated off-screen
    //    (.collapsed present → translateX(100%) against a 360px width = fully offscreen).
    el.style.width = 'var(--panel-w)';
    // 2) Pre-paint window: populate now, before anything is visible (AC7).
    if (opts && opts.beforeReveal) opts.beforeReveal();
    // 3) Force a synchronous reflow so the width write is committed before the class flip.
    void el.offsetWidth;
    // 4) Next frame: drop .collapsed so ONLY transform animates in (never coalesced
    //    into one paint with the width write — that would snap, the old jump).
    requestAnimationFrame(() => {
      el.classList.remove('collapsed');
    });
  } else {
    // Slide out: transform animates to translateX(100%); release the box afterwards.
    el.classList.add('collapsed');
    const release = () => {
      // Act on LIVE state, not this closure's: a re-open may have landed first.
      if (el.classList.contains('collapsed')) el.style.width = '0px';
    };
    const onEnd = (e) => {
      if (e.target !== el || e.propertyName !== 'transform') return; // guard (i)
      el.removeEventListener('transitionend', onEnd);
      const s = slideState.get(el);
      if (s && s.timer) clearTimeout(s.timer);
      slideState.delete(el);
      release(); // guard (ii): re-reads live state
    };
    // Fallback timeout (guard iii): release even if transitionend never fires (transform
    // value unchanged, element hidden, etc.). Slack beyond the transition duration.
    const timer = setTimeout(() => {
      el.removeEventListener('transitionend', onEnd);
      slideState.delete(el);
      release();
    }, SLIDE_MS + 60);
    slideState.set(el, { timer, onEnd });
    el.addEventListener('transitionend', onEnd);
  }
}

// Both panels boot `.collapsed` (index.html). Since `.collapsed` no longer carries
// `width:0` (slidePanel owns width), seed the at-rest collapsed box to 0 so #webviews
// has the full width on first paint (AC3) — otherwise the default #media-panel
// `width: var(--panel-w)` would reserve 360px behind the off-screen transform.
for (const p of [els.panel, els.privacyPanel]) {
  if (p.classList.contains('collapsed')) p.style.width = '0px';
}

/* --------------------------------------------------------------- media panel */

function togglePanel(force) {
  const collapsed = els.panel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  slidePanel(els.panel, show); // owns width/transform/transitionend (AC11)
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
els.toggleMedia.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('media', els.toggleMedia); });
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
  slidePanel(els.privacyPanel, false); // owns width/transform/transitionend (AC11)
  els.togglePrivacy.classList.remove('active');
  // Opening the media panel calls this directly, so sync aria-expanded here too
  // or the privacy toggle would keep a stale "true" after being collapsed.
  els.togglePrivacy.setAttribute('aria-expanded', 'false');
}

function togglePrivacy(force) {
  const collapsed = els.privacyPanel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  els.togglePrivacy.classList.toggle('active', show);
  els.togglePrivacy.setAttribute('aria-expanded', String(show));
  if (show) {
    togglePanel(false); // close the media panel
    // Prong B: populate Shields content in slidePanel's pre-paint window (width set,
    // still .collapsed → off-screen) BEFORE the slide reveals it — no empty body, no
    // mid-slide rebuild (AC7). updatePrivacyBadge() runs too (renderPrivacy does it;
    // populatePrivacy doesn't, so call it explicitly to keep the toolbar badge fresh).
    slidePanel(els.privacyPanel, true, {
      beforeReveal: () => {
        updatePrivacyBadge();
        populatePrivacy();
      }
    });
    // Defer the async cookie fetch's re-render past the slide so the "Loading…" →
    // count swap lands at rest, never mid-slide (AC8). First paint shows "Loading…"
    // already placed by populatePrivacy above.
    setTimeout(fetchCookies, SLIDE_MS + 20);
    els.privacyClose.focus(); // only move focus when actually opening
  } else {
    const focusWasInside = els.privacyPanel.contains(document.activeElement);
    slidePanel(els.privacyPanel, false); // slide out + release box (AC11)
    if (focusWasInside) {
      // Closing while focus is inside the (now zero-width) panel would strand it:
      // restore focus to the toggle. Guard avoids stealing focus on programmatic closes.
      // Focus-restoration guard: if the button is unpinned (hidden), .focus() is a
      // silent no-op that strands focus on <body> — skip it when the button is hidden.
      if (!els.togglePrivacy.classList.contains('hidden')) els.togglePrivacy.focus();
    }
  }
}

els.togglePrivacy.addEventListener('click', () => togglePrivacy());
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
  try {
    tab.webview.findInPage(text, { findNext: false, forward: true, matchCase: false, ...opts });
  } catch {
    // webview not yet ready — ignore; the next input event will retry
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
  if (t) {
    t.findOpen = false;
    try {
      t.webview.stopFindInPage('clearSelection');
    } catch { /* webview gone */ }
    // Restore keyboard focus to the page (AC5 — explicit a11y item).
    try {
      t.webview.focus();
    } catch { /* webview gone */ }
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

// Event-driven re-render entry point: badge always; the heavy body rebuild only when
// the panel is open. The collapsed early-return is load-bearing — it keeps net/
// permission/shields-config/tab-nav events from rebuilding a closed panel (AC9).
function renderPrivacy() {
  updatePrivacyBadge();
  if (els.privacyPanel.classList.contains('collapsed')) return;
  populatePrivacy();
}

// The full #privacy-body rebuild, with NO collapsed guard, so the open path can
// populate content while the panel is still .collapsed (laid out off-screen) BEFORE
// the slide reveals it (AC7, Prong B). Direct callers other than renderPrivacy must
// only invoke this when the panel has its open layout box (width set) — i.e. from
// slidePanel's beforeReveal.
function populatePrivacy() {
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
      if (t) t.webview.reload();
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
