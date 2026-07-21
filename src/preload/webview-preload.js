'use strict';

// Injected into every web page rendered in a guest WebContentsView tab (wired
// as the web-branch tab's webPreferences.preload, running in the page main
// world). Walks the DOM, collects every piece of media (images, video, audio,
// embeds), and streams the catalog up to the browser UI via ipcRenderer.send
// ('guest-media-list'). (Filename retained for history; the tab is a
// WebContentsView, not a <webview> element.)

const { ipcRenderer } = require('electron');
const { fillLoginForm, findAllLoginFields, findLoginFields } = require('./vault-fill-fields');

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
    const w = desc.endsWith('w') ? parseInt(desc) : desc.endsWith('x') ? parseFloat(desc) * 1000 : 0;
    if (url && w > bestW) {
      bestW = w;
      best = url;
    }
  }
  return best;
}

// Extension -> media type, for direct file links (e.g. <a href="song.mp3">).
const EXT_TYPE = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  avif: 'image',
  tiff: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  ogv: 'video',
  mkv: 'video',
  avi: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
  opus: 'audio',
  wma: 'audio'
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
  for (const a of /** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('a[href]'))) {
    const type = classifyByExt(a.href);
    if (type) {
      const label = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      add(type, a.href, label ? { label } : {});
    }
  }

  // --- meta images (og:image / twitter:image) ---
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[property="og:image:url"]']) {
    for (const meta of /** @type {NodeListOf<HTMLMetaElement>} */ (document.querySelectorAll(sel)))
      add('image', meta.content);
  }

  // --- embeds (YouTube/Vimeo iframes etc.) — can't fetch, but offer to open ---
  for (const f of /** @type {NodeListOf<HTMLIFrameElement>} */ (document.querySelectorAll('iframe[src]'))) {
    const src = f.src || '';
    if (/youtube|youtu\.be|vimeo|dailymotion|soundcloud|spotify|twitch/i.test(src)) {
      add('embed', src, { allowBlob: false });
    }
  }

  return Array.from(items.values());
}

function send() {
  try {
    ipcRenderer.send('guest-media-list', collect());
  } catch {
    /* page navigated away mid-scan */
  }
}

// Debounced rescan on DOM mutation (sites lazy-load media constantly).
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;
function scheduleScan(delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(send, delay);
}

// ---------------------------------------------------------------------------
// Vault lock-icon injection (M12 F2 Leg 1, DD1/DD2/DD3/DD9).
//
// A DECORATIVE, spoofable lock icon is injected into each detected login form in
// the guest MAIN WORLD (contextIsolation is off). It carries NO secret and its
// click emits only a bare "the user gestured on this tab" trigger — main derives
// the trusted wcId from event.sender.id and drives the chrome-owned prompt, so a
// hostile page that fakes/hides the icon gains nothing (DD1). Injection is
// TOP-FRAME ONLY (matches fillLoginForm's window.top === window guard) and
// suppressed entirely in burner/non-persistent tabs via a main-provided
// eligibility flag queried once at init (DD9).
// ---------------------------------------------------------------------------

// Top-frame gate FIRST: no query, no icons, no listeners inside a subframe (a
// cross-origin iframe login must never raise the prompt via the shared tab wcId).
const IS_TOP_FRAME = (typeof window === 'undefined') || window.top === window;

// Eligibility: main answers `true` only when this tab's session resolves to a
// PERSISTENT jar (resolvePersistJar). Mirrors the `shields-farble` sync-IPC idiom.
let vaultEligible = false;
if (IS_TOP_FRAME) {
  try {
    vaultEligible = !!ipcRenderer.sendSync('vault-eligible');
  } catch {
    /* main not ready / not eligible → no icons */
  }
}

// Every injected icon node is tracked here so the MEDIA observer can filter out
// icon-only DOM/style mutations before scheduleScan — otherwise appending an icon
// (childList) and positioning it via `.style` (style attr, which the media
// observer watches) would re-fire scheduleScan → collect() forever (HIGH).
const iconNodes = new WeakSet();
// Icons currently in the DOM, for pruning (WeakSet isn't iterable). Each icon
// carries `_anchor` (its form, or the form-less password field) for reverse lookup.
const placedIcons = new Set();
// anchor (form | password field) → icon element, so re-scans reposition rather
// than stack. WeakMap keys are DOM nodes → a removed form/field can be GC'd.
const iconByAnchor = new WeakMap();

// True iff a mutation is purely icon bookkeeping (icon append/remove, or an icon's
// own style/attr change) — such mutations must NOT trigger the media rescan.
function isIconOnlyMutation(m) {
  if (m.type === 'attributes') return iconNodes.has(m.target);
  if (m.type === 'childList') {
    const added = Array.from(m.addedNodes);
    const removed = Array.from(m.removedNodes);
    if (!added.length && !removed.length) return false;
    return added.every((n) => iconNodes.has(n)) && removed.every((n) => iconNodes.has(n));
  }
  return false;
}

// Capture the genuine isTrusted getter ONCE at init. contextIsolation is off, so
// a hostile page can override Event.prototype's isTrusted getter; reading the
// captured getter is annoyance-hardening only (a determined page can still raise
// the prompt — it can NEVER complete a chrome-owned fill, DD1/DD3).
const isTrustedGet = (() => {
  try {
    return (typeof Event !== 'undefined')
      && Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get;
  } catch {
    return null;
  }
})();

function onIconClick(e) {
  const trusted = isTrustedGet ? isTrustedGet.call(e) : e.isTrusted;
  if (!trusted) return; // scripted iconEl.click() / synthetic dispatch → ignored
  try {
    ipcRenderer.send('guest-vault-gesture', {}); // NO secret — wcId derived in main
  } catch {
    /* page navigated away mid-click */
  }
}

function createVaultIcon() {
  const el = document.createElement('div');
  el.setAttribute('data-goldfinch-vault-lock', '');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Fill login from vault');
  el.textContent = '🔒'; // 🔒
  const s = el.style;
  s.position = 'absolute';
  s.zIndex = '2147483647';
  s.cursor = 'pointer';
  s.fontSize = '14px';
  s.lineHeight = '16px';
  s.width = '16px';
  s.height = '16px';
  s.textAlign = 'center';
  s.userSelect = 'none';
  s.pointerEvents = 'auto';
  el.addEventListener('click', onIconClick);
  return el;
}

function positionVaultIcon(icon, rect) {
  const top = rect.top + (window.scrollY || 0) + (rect.height - 16) / 2;
  const left = rect.left + (window.scrollX || 0) + rect.width - 20;
  icon.style.top = `${Math.max(0, top)}px`;
  icon.style.left = `${Math.max(0, left)}px`;
}

// A field is a valid anchor only if it's actually rendered — zero-size / display:none
// honeypots (0×0 rect, or offsetParent null) get NO icon (else a 0×0 icon lands at
// the page's top-left corner).
function isFieldVisible(field) {
  if (typeof field.getBoundingClientRect !== 'function') return null;
  const rect = field.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  if (field.offsetParent === null) return null;
  return rect;
}

function placeVaultIcons() {
  if (!vaultEligible || !IS_TOP_FRAME) return;
  const parent = document.body || document.documentElement;
  if (!parent) return;

  const activeAnchors = new Set();
  const seenAnchors = new Set();
  for (const entry of findAllLoginFields(document)) {
    // One icon per FORM (a form-less password field is its own anchor).
    const anchor = entry.form || entry.password;
    if (seenAnchors.has(anchor)) continue;
    seenAnchors.add(anchor);

    const rect = isFieldVisible(entry.password);
    if (!rect) continue; // zero-rect / non-visible → skip (icon pruned below)

    activeAnchors.add(anchor);
    let icon = iconByAnchor.get(anchor);
    if (!icon || !icon.isConnected) {
      icon = createVaultIcon();
      icon._anchor = anchor;
      iconByAnchor.set(anchor, icon);
      iconNodes.add(icon);
      placedIcons.add(icon);
      parent.appendChild(icon);
    }
    positionVaultIcon(icon, rect);
  }

  // Prune icons whose form/field vanished or went non-visible this pass.
  for (const icon of placedIcons) {
    if (!activeAnchors.has(icon._anchor)) {
      icon.remove();
      placedIcons.delete(icon);
      iconByAnchor.delete(icon._anchor);
    }
  }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let iconTimer = null;
function scheduleIconPlacement(delay = 300) {
  if (!vaultEligible || !IS_TOP_FRAME) return;
  clearTimeout(iconTimer);
  iconTimer = setTimeout(placeVaultIcons, delay);
}

window.addEventListener('DOMContentLoaded', () => {
  scheduleScan(150);
  scheduleIconPlacement(150);
});
window.addEventListener('load', () => {
  scheduleScan(300);
  scheduleIconPlacement(300);
});

const observer = new MutationObserver((mutations) => {
  // Icon-only mutations (our own append/reposition) must not re-arm the media
  // rescan or the scan would never settle (HIGH — DD3 feedback loop).
  if (mutations.every(isIconOnlyMutation)) return;
  scheduleScan(600);
  scheduleIconPlacement(600);
});
if (document.documentElement) {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style', 'poster']
  });
}

// Allow the UI to force a refresh.
ipcRenderer.on('rescan-media', () => send());

// Vault fill (M12 F1 Leg 4): the main→preload credential-injection channel. The
// resolved credential arrives ONLY here (never over the MCP wire) and is filled
// into the TOP-FRAME login form; fillLoginForm guards `window.top === window`
// and webContents.send targets the main frame, so a cross-origin iframe is never
// filled. page JS cannot register a rogue 'vault-fill' listener — the guest runs
// nodeIntegration:false, so it has no ipcRenderer (DD7).
ipcRenderer.on('vault-fill', (_e, cred) => fillLoginForm(document, cred));

// Vault capture (M12 F2 Leg 4, DD7): a capturing `submit` listener on detected login
// forms (top-frame + vault-eligible only — the same gate as the lock icon; burner /
// non-persistent tabs answer `vaultEligible=false`, so no observer). On a real form
// submit whose form contains a detected login field, read the just-typed
// { username, password } BEFORE navigation and send them to main — the password as a
// Uint8Array (never a lingering JS string on the wire). The ORIGIN is NOT sent: main
// derives it from the sender URL (a guest-supplied origin is never trusted). v1 covers
// real <form> submits only; SPA / fetch logins with no submit event are a documented
// F3 gap. contextIsolation is off, so a page could dispatch a synthetic submit — but
// the credential captured is the user's OWN just-typed value (within the trust model),
// and the prompt is chrome-owned, so a spurious offer leaks nothing.
if (IS_TOP_FRAME && vaultEligible) {
  document.addEventListener('submit', (e) => {
    try {
      const form = /** @type {any} */ (e.target);
      if (!form || typeof form.querySelectorAll !== 'function') return;
      const fields = findLoginFields(form);
      if (!fields || !fields.password) return;
      const password = fields.password.value != null ? String(fields.password.value) : '';
      const username = fields.username && fields.username.value != null
        ? String(fields.username.value)
        : '';
      const passwordBytes = new TextEncoder().encode(password);
      ipcRenderer.send('guest-vault-capture', { username, password: passwordBytes });
    } catch {
      /* page mutated / navigated mid-submit — drop the capture (no offer this time) */
    }
  }, true);
}

// ---------------------------------------------------------------------------
// Privacy: fingerprinting detection. The webview runs this preload in the
// page's MAIN world (contextIsolation=no), so we can wrap the fingerprinting-
// prone APIs directly — CSP-immune and reliable, unlike injecting a script.
// ---------------------------------------------------------------------------
const fpCounts = { canvas: 0, webgl: 0, audio: 0 };
/** @type {ReturnType<typeof setTimeout> | null} */
let fpTimer = null;
function bumpFp(kind) {
  fpCounts[kind]++;
  if (fpTimer) return;
  fpTimer = setTimeout(() => {
    fpTimer = null;
    try {
      ipcRenderer.send('guest-privacy-fp', fpCounts);
    } catch {
      /* ipc unavailable */
    }
  }, 500);
}

// Ask main (synchronously, before page scripts run) whether to farble and with
// which per-jar seed.
let FARBLE = false;
let SEED = 0;
try {
  const cfg = ipcRenderer.sendSync('shields-farble', location.href);
  FARBLE = !!(cfg && cfg.farble);
  SEED = (cfg && cfg.seed) >>> 0;
} catch {
  /* shields off */
}

// Deterministic per-(seed,index) hash so noise is STABLE within a session (a
// site re-reading the same canvas gets the same fake result — randomizing every
// read would be both detectable and self-defeating).
function h32(a, b) {
  let h = (a ^ b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function farbleImageData(d) {
  for (let i = 0; i < d.length; i += 4) {
    const hv = h32(SEED, i);
    if ((hv & 7) === 0) {
      // perturb ~1/8 of pixels by +/-1
      const ch = i + (hv % 3);
      const v = d[ch] + (hv & 8 ? 1 : -1);
      d[ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

(function installFingerprintHooks() {
  try {
    const c2dProto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    const origGID = c2dProto && c2dProto.getImageData;

    if (c2dProto && origGID) {
      c2dProto.getImageData = function () {
        bumpFp('canvas');
        const img = origGID.apply(this, arguments);
        if (FARBLE) farbleImageData(img.data);
        return img;
      };
    }

    const cv = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
    if (cv) {
      const noiseCanvas = (canvas) => {
        if (!FARBLE || !origGID) return;
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) return;
          const img = origGID.call(ctx, 0, 0, canvas.width, canvas.height);
          farbleImageData(img.data);
          ctx.putImageData(img, 0, 0);
        } catch {
          /* webgl canvas etc. */
        }
      };
      ['toDataURL', 'toBlob'].forEach((m) => {
        if (!cv[m]) return;
        const orig = cv[m];
        cv[m] = function () {
          bumpFp('canvas');
          noiseCanvas(this);
          return orig.apply(this, arguments);
        };
      });
    }

    [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach((GL) => {
      if (!GL || !GL.prototype.getParameter) return;
      const gp = GL.prototype.getParameter;
      GL.prototype.getParameter = function (p) {
        if (p === 37445 || p === 37446) {
          bumpFp('webgl');
          if (FARBLE) return p === 37445 ? 'Google Inc.' : 'ANGLE (Generic GPU)'; // generic vendor/renderer
        }
        return gp.apply(this, arguments);
      };
    });

    const AN = window.AnalyserNode && window.AnalyserNode.prototype;
    if (AN && AN.getFloatFrequencyData) {
      const gffd = AN.getFloatFrequencyData;
      AN.getFloatFrequencyData = function (arr) {
        bumpFp('audio');
        gffd.apply(this, arguments);
        if (FARBLE && arr && arr.length) {
          for (let i = 0; i < arr.length; i++) arr[i] += (h32(SEED, i) / 4294967296 - 0.5) * 0.0002;
        }
      };
    }

    // Reduce entropy: report common, fixed device values instead of the real ones.
    if (FARBLE) {
      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
      } catch {
        /* already defined */
      }
      try {
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
      } catch {
        /* already defined */
      }
    }
  } catch {
    /* ignore */
  }
})();
