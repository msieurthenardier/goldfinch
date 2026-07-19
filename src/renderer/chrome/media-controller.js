/** @typedef {any} Tab */

/** @param {any} deps */
export function createMediaController(deps) {
  const {
    window, document, ctx, els, activeTab, isInternalTab, closePrivacyPanel,
    sendActiveBounds, isSafePosterUrl, escapeHtml,
    openToolbarContextMenu, createTab
  } = deps;
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
      // silent no-op that strands focus on <body> — fall back to the address bar.
      if (!els.toggleMedia.classList.contains('hidden')) els.toggleMedia.focus();
      else els.address.focus();
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
    // Internal tabs are excluded by the disabled button state (tab-scoped toolbar disable).
    if (!t || t.wcId == null || isInternalTab(t)) return;
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
      ctx.activeFilter = f.dataset.filter;
      renderMedia();
    })
  );

  // Items currently shown in the panel, honoring the active filter.
  function visibleItems() {
    const media = (activeTab() && activeTab().media) || [];
    return ctx.activeFilter === 'all' ? media : media.filter((m) => m.type === ctx.activeFilter);
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
    if (isBulkDownload(d.url)) return; // batch shows one aggregate toast
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
    if (consumeDownloadDone(d)) return;
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

  function consumeDownloadDone(download) {
    if (!bulk.active || !bulk.urls.has(download.url)) return false;
    bulkComplete(download.url, download.state === 'completed');
    return true;
  }

  function isBulkDownload(url) {
    return bulk.active && bulk.urls.has(url);
  }

  return {
    togglePanel,
    renderMedia,
    openLightbox,
    closeLightbox,
    downloadItem,
    downloadSelected,
    bulkComplete,
    isBulkDownload,
    consumeDownloadDone,
    playAudio,
    playPrev,
    playNext,
    toast,
    persistentToast
  };
}
