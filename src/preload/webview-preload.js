'use strict';

// Injected into every page rendered in a <webview> tab. Walks the DOM,
// collects every piece of media (images, video, audio, embeds), and streams
// the catalog up to the browser UI via ipcRenderer.sendToHost.

const { ipcRenderer } = require('electron');

function absUrl(src) {
  if (!src) return null;
  try {
    return new URL(src, document.baseURI || location.href).href;
  } catch {
    return null;
  }
}

// Pick the highest-resolution candidate from a srcset string.
function bestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  let bestW = -1;
  for (const part of srcset.split(',')) {
    const tokens = part.trim().split(/\s+/);
    const url = tokens[0];
    const desc = tokens[1] || '';
    const w = desc.endsWith('w') ? parseInt(desc) : (desc.endsWith('x') ? parseFloat(desc) * 1000 : 0);
    if (url && w > bestW) {
      bestW = w;
      best = url;
    }
  }
  return best;
}

// Extension -> media type, for direct file links (e.g. <a href="song.mp3">).
const EXT_TYPE = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image', tiff: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio', wma: 'audio'
};

function classifyByExt(url) {
  try {
    const ext = new URL(url, document.baseURI || location.href).pathname.toLowerCase().split('.').pop();
    return EXT_TYPE[ext] || null;
  } catch {
    return null;
  }
}

function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last && last.length ? decodeURIComponent(last) : u.hostname;
  } catch {
    return 'media';
  }
}

function collect() {
  const items = new Map(); // url -> item

  const add = (type, url, extra = {}) => {
    const abs = absUrl(url);
    if (!abs) return;
    if (abs.startsWith('blob:') && !extra.allowBlob) return; // blob: can't be re-fetched outside the page
    if (items.has(abs)) {
      // Merge in any newly-discovered metadata (e.g. dimensions).
      Object.assign(items.get(abs), Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)));
      return;
    }
    items.set(abs, {
      type,
      url: abs,
      name: fileNameFromUrl(abs),
      ...extra
    });
  };

  // --- images ---
  for (const img of document.images) {
    const src = bestFromSrcset(img.currentSrc || img.getAttribute('srcset')) || img.currentSrc || img.src;
    add('image', src, {
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
      alt: img.alt || null
    });
  }

  // <picture><source srcset>
  for (const source of document.querySelectorAll('picture source[srcset]')) {
    add('image', bestFromSrcset(source.getAttribute('srcset')));
  }

  // --- CSS background images (capped + time-boxed for huge pages) ---
  const start = Date.now();
  let scanned = 0;
  for (const el of document.querySelectorAll('*')) {
    if (scanned++ > 6000 || Date.now() - start > 250) break;
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) {
      const matches = bg.matchAll(/url\((['"]?)(.*?)\1\)/g);
      for (const m of matches) {
        if (!m[2].startsWith('data:')) add('image', m[2]);
      }
    }
  }

  // --- video ---
  for (const v of document.querySelectorAll('video')) {
    const poster = absUrl(v.poster);
    if (v.src) add('video', v.src, { width: v.videoWidth || null, height: v.videoHeight || null, poster });
    for (const s of v.querySelectorAll('source')) add('video', s.src, { poster });
  }

  // --- audio ---
  for (const a of document.querySelectorAll('audio')) {
    if (a.src) add('audio', a.src);
    for (const s of a.querySelectorAll('source')) add('audio', s.src);
  }

  // --- direct file links: <a href="...mp3 / .mp4 / .jpg"> ---
  // Many sites (music blogs, galleries) expose media purely as anchor links.
  for (const a of document.querySelectorAll('a[href]')) {
    const type = classifyByExt(a.href);
    if (type) {
      const label = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      add(type, a.href, label ? { label } : {});
    }
  }

  // --- meta images (og:image / twitter:image) ---
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[property="og:image:url"]']) {
    for (const meta of document.querySelectorAll(sel)) add('image', meta.content);
  }

  // --- embeds (YouTube/Vimeo iframes etc.) — can't fetch, but offer to open ---
  for (const f of document.querySelectorAll('iframe[src]')) {
    const src = f.src || '';
    if (/youtube|youtu\.be|vimeo|dailymotion|soundcloud|spotify|twitch/i.test(src)) {
      add('embed', src, { allowBlob: false });
    }
  }

  return Array.from(items.values());
}

function send() {
  try {
    ipcRenderer.sendToHost('media-list', collect());
  } catch {
    /* page navigated away mid-scan */
  }
}

// Debounced rescan on DOM mutation (sites lazy-load media constantly).
let timer = null;
function scheduleScan(delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(send, delay);
}

window.addEventListener('DOMContentLoaded', () => scheduleScan(150));
window.addEventListener('load', () => scheduleScan(300));

const observer = new MutationObserver(() => scheduleScan(600));
if (document.documentElement) {
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'poster'] });
}

// Allow the UI to force a refresh.
ipcRenderer.on('rescan-media', () => send());
