'use strict';

/* Goldfinch browser UI controller: tabs, navigation, and the media panel. */

const HOMEPAGE = 'https://www.google.com';

const els = {
  tabs: document.getElementById('tabs'),
  newTab: document.getElementById('new-tab'),
  webviews: document.getElementById('webviews'),
  back: document.getElementById('back'),
  forward: document.getElementById('forward'),
  reload: document.getElementById('reload'),
  address: document.getElementById('address'),
  toggleMedia: document.getElementById('toggle-media'),
  mediaCount: document.getElementById('media-count'),
  panel: document.getElementById('media-panel'),
  mediaList: document.getElementById('media-list'),
  mediaEmpty: document.getElementById('media-empty'),
  mediaClose: document.getElementById('media-close'),
  mediaRescan: document.getElementById('media-rescan'),
  mediaDownloadAll: document.getElementById('media-download-all'),
  filters: document.querySelectorAll('.filter'),
  toasts: document.getElementById('toasts'),
  lightbox: document.getElementById('lightbox'),
  lightboxStage: document.getElementById('lightbox-stage'),
  lightboxCaption: document.getElementById('lightbox-caption'),
  lightboxZoomLevel: document.getElementById('lightbox-zoom-level'),
  lightboxClose: document.getElementById('lightbox-close'),
  lightboxZoomIn: document.getElementById('lightbox-zoom-in'),
  lightboxZoomOut: document.getElementById('lightbox-zoom-out'),
  lightboxZoomReset: document.getElementById('lightbox-zoom-reset'),
  player: document.getElementById('player'),
  playerAudio: document.getElementById('player-audio'),
  playerTitle: document.getElementById('player-title'),
  playerProgress: document.getElementById('player-progress'),
  playerSeek: document.getElementById('player-seek'),
  playerCur: document.getElementById('player-cur'),
  playerDur: document.getElementById('player-dur'),
  playerPlay: document.getElementById('player-play'),
  playerPrev: document.getElementById('player-prev'),
  playerNext: document.getElementById('player-next')
};

/** @type {Map<string, Tab>} */
const tabs = new Map();
let activeTabId = null;
let activeFilter = 'all';
let tabSeq = 0;

/* ------------------------------------------------------------------ tabs */

function createTab(url = HOMEPAGE) {
  const id = `tab-${++tabSeq}`;

  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('preload', window.goldfinch.webviewPreloadPath);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('partition', 'persist:goldfinch');
  webview.classList.add('hidden');
  els.webviews.appendChild(webview);

  const tab = { id, webview, title: 'New tab', url, favicon: null, media: [], wcId: null };
  tabs.set(id, tab);

  // Tab button in the strip.
  const btn = document.createElement('div');
  btn.className = 'tab';
  btn.dataset.id = id;
  btn.innerHTML = `<img class="tab-fav hidden" /><span class="tab-title">New tab</span><span class="tab-close">✕</span>`;
  btn.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) { closeTab(id); return; }
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
  }
  els.address.value = tab.url || '';
  renderMedia();
  updateNavButtons();
}

function activeTab() { return tabs.get(activeTabId) || null; }

/* ----------------------------------------------------------- webview wiring */

function wireWebview(tab) {
  const wv = tab.webview;

  wv.addEventListener('dom-ready', () => {
    try { tab.wcId = wv.getWebContentsId(); } catch { /* not ready */ }
    updateNavButtons();
  });

  wv.addEventListener('did-start-loading', () => { if (tab.id === activeTabId) els.reload.textContent = '✕'; });
  wv.addEventListener('did-stop-loading', () => { if (tab.id === activeTabId) els.reload.textContent = '⟳'; });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    tab.btn.querySelector('.tab-title').textContent = e.title || tab.url;
    tab.btn.title = e.title || '';
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
    if (tab.id === activeTabId) { els.address.value = tab.url; updateNavButtons(); }
    // Reset media on full navigation; the preload will re-populate.
    tab.media = [];
    if (tab.id === activeTabId) renderMedia();
  };
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', () => {
    tab.url = wv.getURL();
    if (tab.id === activeTabId) { els.address.value = tab.url; updateNavButtons(); }
  });

  // Media catalog streamed up from the webview preload.
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'media-list') {
      tab.media = e.args[0] || [];
      if (tab.id === activeTabId) renderMedia();
    }
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // aborted (normal during fast nav)
  });
}

function updateNavButtons() {
  const tab = activeTab();
  const wv = tab && tab.webview;
  let canBack = false, canFwd = false;
  try { canBack = wv && wv.canGoBack(); canFwd = wv && wv.canGoForward(); } catch { /* not ready */ }
  els.back.disabled = !canBack;
  els.forward.disabled = !canFwd;
}

/* ---------------------------------------------------------------- navigation */

function navigate(input) {
  const tab = activeTab();
  if (!tab) return;
  const url = toUrl(input);
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
  if (e.key === 'Enter') { navigate(els.address.value); els.address.blur(); }
});
els.back.addEventListener('click', () => { const t = activeTab(); try { t.webview.goBack(); } catch {} });
els.forward.addEventListener('click', () => { const t = activeTab(); try { t.webview.goForward(); } catch {} });
els.reload.addEventListener('click', () => {
  const t = activeTab(); if (!t) return;
  if (els.reload.textContent === '✕') t.webview.stop(); else t.webview.reload();
});
els.newTab.addEventListener('click', () => createTab());

/* --------------------------------------------------------------- media panel */

function togglePanel(force) {
  const collapsed = els.panel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  els.panel.classList.toggle('collapsed', !show);
  els.toggleMedia.classList.toggle('active', show);
}
els.toggleMedia.addEventListener('click', () => togglePanel());
els.mediaClose.addEventListener('click', () => togglePanel(false));
els.mediaRescan.addEventListener('click', () => {
  const t = activeTab();
  if (t && t.wcId != null) { try { t.webview.send('rescan-media'); } catch {} }
});

els.filters.forEach((f) => f.addEventListener('click', () => {
  els.filters.forEach((x) => x.classList.remove('active'));
  f.classList.add('active');
  activeFilter = f.dataset.filter;
  renderMedia();
}));

// Items currently shown in the panel, honoring the active filter.
function visibleItems() {
  const media = (activeTab() && activeTab().media) || [];
  return activeFilter === 'all' ? media : media.filter((m) => m.type === activeFilter);
}

function renderMedia() {
  const tab = activeTab();
  const media = (tab && tab.media) || [];
  const filtered = visibleItems();

  els.mediaCount.textContent = media.length ? `Media (${media.length})` : 'Media';
  els.mediaList.innerHTML = '';
  els.mediaEmpty.classList.toggle('hidden', filtered.length > 0);

  for (const item of filtered) els.mediaList.appendChild(mediaCard(item, tab));
}

function mediaCard(item, tab) {
  const card = document.createElement('div');
  card.className = 'media-card';
  card.dataset.url = item.url;

  const thumb = document.createElement('div');
  thumb.className = 'media-thumb';
  thumb.innerHTML = `<span class="badge">${item.type}</span>`;

  const isAV = item.type === 'video' || item.type === 'audio';

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.url;
    thumb.appendChild(img);
    thumb.title = 'Open in viewer';
    thumb.addEventListener('click', () => openLightbox(item));
  } else if (item.type === 'video') {
    if (item.poster) thumb.style.backgroundImage = `url("${item.poster}")`;
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">▶</span>`);
    thumb.title = 'Play here';
    thumb.addEventListener('click', () => playInline(item, thumb));
  } else if (item.type === 'audio') {
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">♪</span>`);
    thumb.title = 'Play in player';
    thumb.addEventListener('click', () => playAudio(item));
    if (player.url === item.url) card.classList.add('playing');
  } else { // embed
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
  meta.innerHTML = `<div class="media-name">${escapeHtml(primary)}</div>` +
    (secondary ? `<div class="media-dims">${escapeHtml(secondary)}</div>` : '');
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'media-actions';

  // Audio plays in the docked player; video plays inline in its card.
  if (item.type === 'audio') actions.appendChild(iconBtn('▶', 'Play', () => playAudio(item)));
  else if (item.type === 'video') actions.appendChild(iconBtn('▶', 'Play here', () => playInline(item, thumb)));

  // Every item gets a pop-out: images -> zoomable viewer, AV -> full-size tab.
  actions.appendChild(iconBtn('↗', item.type === 'image' ? 'Open in viewer' : 'Pop out to new tab', () => popout(item)));

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
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// Swap a video/audio card's thumbnail for a live, playing player in place.
function playInline(item, thumb) {
  if (thumb.dataset.playing === '1') return;
  thumb.dataset.playing = '1';
  thumb.style.cursor = 'default';
  thumb.style.backgroundImage = 'none';
  thumb.classList.add(item.type === 'audio' ? 'audio-live' : 'video-live');
  thumb.innerHTML = `<span class="badge">${item.type}</span>`;
  const player = document.createElement(item.type === 'video' ? 'video' : 'audio');
  player.src = item.url;
  player.controls = true;
  player.autoplay = true;
  player.className = 'inline-player';
  thumb.appendChild(player);
}

// Pop a media item out of the panel into its best full view.
function popout(item) {
  if (item.type === 'image') { openLightbox(item); return; }
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

function resetZoom() { centerImage(); }

function setScale(next, originX, originY) {
  const stage = els.lightboxStage.getBoundingClientRect();
  const cx = (originX != null ? originX : stage.left + stage.width / 2) - stage.left;
  const cy = (originY != null ? originY : stage.top + stage.height / 2) - stage.top;
  const prev = zoom.scale;
  next = Math.min(8, Math.max(0.2, next));
  // Keep the point under the cursor stationary while zooming.
  zoom.tx = cx - ((cx - zoom.tx) * (next / prev));
  zoom.ty = cy - ((cy - zoom.ty) * (next / prev));
  zoom.scale = next;
  applyZoom();
}

function openLightbox(item) {
  els.lightboxStage.innerHTML = '';
  const img = document.createElement('img');
  img.src = item.url;
  img.className = 'lightbox-img';
  img.draggable = false;
  els.lightboxStage.appendChild(img);
  zoom.img = img;
  els.lightboxCaption.textContent = item.label || item.name;
  els.lightbox.classList.remove('hidden');
  // Center once the image has real dimensions (lightbox must be visible first).
  if (img.complete && img.naturalWidth) centerImage();
  img.addEventListener('load', centerImage, { once: true });
}

function closeLightbox() {
  els.lightbox.classList.add('hidden');
  els.lightboxStage.innerHTML = '';
  zoom.img = null;
}

els.lightboxClose.addEventListener('click', closeLightbox);
els.lightboxZoomIn.addEventListener('click', () => setScale(zoom.scale * 1.25));
els.lightboxZoomOut.addEventListener('click', () => setScale(zoom.scale / 1.25));
els.lightboxZoomReset.addEventListener('click', resetZoom);

// Close when clicking the dimmed backdrop (but not the image or toolbar).
els.lightbox.addEventListener('click', (e) => { if (e.target === els.lightbox || e.target === els.lightboxStage) closeLightbox(); });

// Wheel to zoom toward the cursor.
els.lightboxStage.addEventListener('wheel', (e) => {
  if (!zoom.img) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  setScale(zoom.scale * factor, e.clientX, e.clientY);
}, { passive: false });

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

// Esc closes; +/- zoom; 0 resets.
document.addEventListener('keydown', (e) => {
  if (els.lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === '+' || e.key === '=') setScale(zoom.scale * 1.25);
  else if (e.key === '-') setScale(zoom.scale / 1.25);
  else if (e.key === '0') resetZoom();
});

async function downloadItem(item, tab) {
  const res = await window.goldfinch.downloadMedia({
    webContentsId: tab ? tab.wcId : null,
    url: item.url,
    suggestedName: item.name
  });
  if (!res || !res.ok) toast('Download failed', res && res.error ? res.error : 'Unknown error');
}

/* ------------------------------------------------------- download all */

const bulk = { active: false, queue: [], inFlight: 0, max: 4, done: 0, ok: 0, fail: 0, total: 0, dir: null, tab: null, urls: new Set(), toastEl: null };

async function downloadAll() {
  if (bulk.active) { toast('Already downloading', `Batch in progress (${bulk.done}/${bulk.total}).`); return; }
  const tab = activeTab();
  const items = visibleItems().filter((i) => i.type !== 'embed');
  if (!items.length) { toast('Nothing to download', 'No downloadable media in this view.'); return; }
  if (items.length > 30 && !window.confirm(`Download ${items.length} files into a folder?`)) return;

  const dir = await window.goldfinch.chooseDownloadDir();
  if (!dir) return;

  Object.assign(bulk, { active: true, queue: items.slice(), inFlight: 0, done: 0, ok: 0, fail: 0, total: items.length, dir, tab, urls: new Set() });
  bulk.toastEl = persistentToast(`Downloading 0/${bulk.total}…`, dir);
  bulkPump();
}

function bulkPump() {
  while (bulk.active && bulk.inFlight < bulk.max && bulk.queue.length) {
    const item = bulk.queue.shift();
    bulk.inFlight++;
    bulk.urls.add(item.url);
    window.goldfinch.downloadMedia({
      webContentsId: bulk.tab && bulk.tab.wcId,
      url: item.url,
      suggestedName: item.name,
      saveDir: bulk.dir
    }).then((res) => { if (!res || !res.ok) bulkComplete(item.url, false); });
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

els.mediaDownloadAll.addEventListener('click', downloadAll);

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
  if (player.index < 0) { player.list = [item]; player.index = 0; }
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
    c.classList.toggle('playing', c.dataset.url === player.url);
  });
}

function togglePlay() {
  if (!pa.src) return;
  if (pa.paused) pa.play().catch(() => {}); else pa.pause();
}
function playPrev() { if (player.index > 0) { player.index--; loadCurrent(); } }
function playNext() { if (player.index < player.list.length - 1) { player.index++; loadCurrent(); } }

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
pa.addEventListener('loadedmetadata', () => { els.playerDur.textContent = fmtTime(pa.duration); });
pa.addEventListener('play', () => { els.playerPlay.textContent = '▮▮'; });
pa.addEventListener('pause', () => { els.playerPlay.textContent = '▶'; });
pa.addEventListener('ended', () => { if (player.index < player.list.length - 1) playNext(); });

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
  if (bulk.active && bulk.urls.has(d.url)) { bulkComplete(d.url, d.state === 'completed'); return; }
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
  if (e.key === 't') { e.preventDefault(); createTab(); }
  else if (e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  else if (e.key === 'l') { e.preventDefault(); els.address.focus(); els.address.select(); }
  else if (e.key === 'm') { e.preventDefault(); togglePanel(); }
  else if (e.key === 'r') { e.preventDefault(); const t = activeTab(); if (t) t.webview.reload(); }
});

/* ------------------------------------------------------------------- helpers */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------- boot */
createTab(HOMEPAGE);
