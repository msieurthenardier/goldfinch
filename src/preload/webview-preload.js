'use strict';

// Injected into every web page rendered in a guest WebContentsView tab (wired
// as the web-branch tab's webPreferences.preload, running in the page main
// world). Walks the DOM, collects every piece of media (images, video, audio,
// embeds), and streams the catalog up to the browser UI via ipcRenderer.send
// ('guest-media-list'). (Filename retained for history; the tab is a
// WebContentsView, not a <webview> element.)

const { ipcRenderer } = require('electron');
const { fillLoginForm, findAllLoginFields, findLoginFields } = require('./vault-fill-fields');
const { fillCardForm, findAllCardFields, findCardFields } = require('./vault-card-fields');
const { createVaultIconController } = require('./vault-fill-icon');
const { createBookmarkDropListeners } = require('./guest-bookmark-drop');
const { tabBoundary } = require('../shared/tab-boundary');

// ---------------------------------------------------------------------------
// Guest tab-boundary signal (M17 Flight 1 Leg 1, DD2). A capturing keydown on
// window sees an unmodified Tab / Shift+Tab BEFORE any page listener and
// before Chromium's own default Tab action. When tabBoundary says the press
// would leave the page's tabbable sequence, this preload preventDefault()s
// (today's only guest→chrome key handoff — the Ctrl/Cmd+L bridge below —
// always does the same, so the async main round-trip never races a synchronous
// default action) and hands off to main via a payload-minimal
// 'guest-tab-boundary' send — main derives the trusted wcId from
// event.sender.id (the guest-vault-gesture shape), never a renderer-supplied
// one.
//
// Captured EARLY (module top, before any page script can run in this
// main-world preload — contextIsolation:false means this file's top-level
// code executes as the page's first script): addEventListener, and
// Event.prototype.preventDefault, mirroring the setTimeout / isTrustedGet
// capture discipline used elsewhere in this file — a hostile page can
// override Event.prototype's own preventDefault, so the boundary handoff
// calls the CAPTURED native, not event.preventDefault() directly.
// ---------------------------------------------------------------------------
const nativeAddEventListener = window.addEventListener.bind(window);
const nativePreventDefault = Event.prototype.preventDefault;
nativeAddEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const direction = event.shiftKey ? 'backward' : 'forward';
    if (!tabBoundary(document, direction).atBoundary) return;
    nativePreventDefault.call(event);
    ipcRenderer.send('guest-tab-boundary', { direction });
  },
  true
);

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
const IS_TOP_FRAME = typeof window === 'undefined' || window.top === window;

// Eligibility: main answers when this tab's session resolves to a PERSISTENT jar
// (resolvePersistJar). Mirrors the `shields-farble` sync-IPC idiom. Main now returns
// `{ eligible, unlocked }` so the icon can also seed its lock-state glyph; a bare
// boolean is tolerated (back-compat). `vaultLocked` defaults to true (safe/closed).
let vaultEligible = false;
let vaultLocked = true;
if (IS_TOP_FRAME) {
  try {
    const res = ipcRenderer.sendSync('vault-eligible');
    if (res && typeof res === 'object') {
      vaultEligible = !!res.eligible;
      vaultLocked = res.unlocked !== true; // unlocked:true → not locked
    } else {
      vaultEligible = !!res;
    }
  } catch {
    /* main not ready / not eligible → no icons */
  }
}

// Capture the genuine isTrusted getter ONCE at init. contextIsolation is off, so
// a hostile page can override Event.prototype's isTrusted getter; reading the
// captured getter is annoyance-hardening only (a determined page can still raise
// the prompt — it can NEVER complete a chrome-owned fill, DD1/DD3).
const isTrustedGet = (() => {
  try {
    return typeof Event !== 'undefined' && Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get;
  } catch {
    return null;
  }
})();

// The decorative fill-icon subsystem (SVG glyph, both-field placement, focus
// gating, isTrusted-guarded click/contextmenu → bare IPCs) lives in the
// electron-free `vault-fill-icon` core so it unit-tests headlessly. All DOM /
// electron coupling is injected here; F2 invariants are enforced inside it.
const vaultIcons = createVaultIconController({
  document,
  window,
  ipcRenderer,
  isTrustedGet,
  findAllLoginFields,
  findAllCardFields,
  getEnabled: () => vaultEligible && IS_TOP_FRAME,
  getVaultLocked: () => vaultLocked
});

// The icon appears ONLY while its field is focused (problem 3): a username or
// password field's focusin shows ITS icon; focusout hides it (deferred so a
// click on the icon — which keeps focus via mousedown preventDefault — is never
// eaten). Icons are placed on BOTH the username and password field (problem 2).
if (IS_TOP_FRAME && vaultEligible) {
  document.addEventListener('focusin', vaultIcons.handleFocusIn);
  document.addEventListener('focusout', vaultIcons.handleFocusOut);
  // Keep the shown icon glued to its field across layout shifts (a focused
  // field can move under scroll/resize/zoom without a DOM mutation firing).
  window.addEventListener('scroll', () => vaultIcons.placeVaultIcons(), true);
  window.addEventListener('resize', () => vaultIcons.placeVaultIcons());
  // Live vault lock-state push from main (unlock / lock / idle auto-lock): flip the
  // in-field icon glyph + color WITHOUT a page reload. Non-secret boolean only.
  ipcRenderer.on('vault-lock-changed', (_e, payload) => {
    vaultLocked = !(payload && payload.unlocked === true);
    vaultIcons.setVaultLocked(vaultLocked);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  scheduleScan(150);
  vaultIcons.scheduleIconPlacement(150);
});
window.addEventListener('load', () => {
  scheduleScan(300);
  vaultIcons.scheduleIconPlacement(300);
});

const observer = new MutationObserver((mutations) => {
  // Icon-only mutations (our own append/reposition) must not re-arm the media
  // rescan or the scan would never settle (HIGH — DD3 feedback loop).
  if (mutations.every(vaultIcons.isIconOnlyMutation)) return;
  scheduleScan(600);
  vaultIcons.scheduleIconPlacement(600);
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
// A gesture-initiated fill lands on the CLICKED form's field (finding 9): consume the
// single-use, TTL-bound target the icon controller recorded on the trusted click. A
// non-gesture fill (MCP automation) has no pending target → consumeFillTarget() is null
// → fillLoginForm falls back to the first-password-field heuristic (unchanged behavior).
ipcRenderer.on('vault-fill', (_e, cred) => fillLoginForm(document, cred, vaultIcons.consumeFillTarget('login')));

// Vault CARD fill (issue #152): the card twin of `vault-fill`. Same trust shape — the
// resolved card arrives ONLY here (never over the MCP wire, which stays login-only) and
// is filled into the TOP-FRAME card form; `fillCardForm` guards `window.top === window`
// and `webContents.send` targets the main frame, so a cross-origin iframe is never
// filled. The gesture-bound target is consumed with an explicit 'card' kind so a login
// binding can never be redirected into a card form.
ipcRenderer.on('vault-fill-card', (_e, card) => fillCardForm(document, card, vaultIcons.consumeFillTarget('card')));

// Vault capture (M12 F2 Leg 4, DD7): a capturing `submit` listener on detected login
// forms (top-frame + vault-eligible only — the same gate as the lock icon; burner /
// non-persistent tabs answer `vaultEligible=false`, so no observer). On a real form
// submit whose form contains a detected login field, read the just-typed
// { username, password } BEFORE navigation and send them to main — the password as a
// Uint8Array (never a lingering JS string on the wire). The ORIGIN is NOT sent: main
// derives it from the sender URL (a guest-supplied origin is never trusted). v1 covers
// real <form> submits only; SPA / fetch logins with no submit event are a documented
// F3 gap.
//
// Leg 2 (F3 DD4): gated on the GENUINE isTrusted (the same captured `isTrustedGet`
// getter the fill-icon controller reads, mirroring vault-fill-icon.js's readTrusted) —
// a synthetic/page-dispatched submit (`form.submit()`/`form.dispatchEvent(new
// Event('submit'))`) is now ignored outright rather than accepted. This closes the two
// cases the prior "leaks nothing" tradeoff still left open: a hostile page raising a
// SPURIOUS vault-capture offer for a credential the user never actually submitted, and
// a page steering the save/update DISPOSITION (new vs. existing entry) by forging
// submits against a form it controls. contextIsolation is still off, so a hostile page
// can still fabricate a *trusted*-looking submit only by getting the real browser to
// dispatch one — i.e. a real user submit — which is exactly the credential this
// listener is meant to capture.
if (IS_TOP_FRAME && vaultEligible) {
  document.addEventListener(
    'submit',
    (e) => {
      if (!(isTrustedGet ? isTrustedGet.call(e) : e.isTrusted)) return;
      try {
        const form = /** @type {any} */ (e.target);
        if (!form || typeof form.querySelectorAll !== 'function') return;
        const fields = findLoginFields(form);
        if (fields && fields.password) {
          const password = fields.password.value != null ? String(fields.password.value) : '';
          const username = fields.username && fields.username.value != null ? String(fields.username.value) : '';
          const passwordBytes = new TextEncoder().encode(password);
          ipcRenderer.send('guest-vault-capture', { username, password: passwordBytes });
          return;
        }
        // Payment-card capture (issue #152). Same trusted-submit gate, same
        // bytes-not-strings discipline for the two real payment secrets (the PAN and
        // the CVV); the cardholder name and expiry ride as plain strings — they are
        // low-value alone and main holds them in the zeroizable record regardless.
        // Main applies the plausibility gate (Luhn + length), so a mis-detected field
        // never becomes a save offer. A form is a login form OR a card form, never both
        // in one submit — the login branch returns above.
        const card = findCardFields(form);
        if (!card || !card.number) return;
        const number = card.number.value != null ? String(card.number.value) : '';
        if (number === '') return;
        const cvv = card.csc && card.csc.value != null ? String(card.csc.value) : '';
        const cardholder = card.cardholder && card.cardholder.value != null ? String(card.cardholder.value) : '';
        const expiry = readSubmittedExpiry(card);
        const encoder = new TextEncoder();
        ipcRenderer.send('guest-vault-capture-card', {
          number: encoder.encode(number),
          cvv: encoder.encode(cvv),
          cardholder,
          expiry
        });
      } catch {
        /* page mutated / navigated mid-submit — drop the capture (no offer this time) */
      }
    },
    true
  );
}

// The submitted expiry as a single `MM/YY`-ish string, from either the combined
// `cc-exp` field or the split month/year pair. Returns '' when neither is present or
// filled — main stores a null expiry rather than a fabricated one.
function readSubmittedExpiry(card) {
  if (card.expiry && card.expiry.value) return String(card.expiry.value);
  const month = card.expMonth && card.expMonth.value ? String(card.expMonth.value) : '';
  const year = card.expYear && card.expYear.value ? String(card.expYear.value) : '';
  if (!month || !year) return '';
  return `${month.padStart(2, '0')}/${year}`;
}

// ---------------------------------------------------------------------------
// Drag a bookmark onto the page (M15 F3 "Drag Interactions" Leg 4, DD5/DD5b/DD6).
//
// Two listeners on `window`, BUBBLE phase, registered in EVERY frame (the frame-
// scope decision and the full mechanism live in guest-bookmark-drop.js's header;
// this site owns only the document-start captures and the registration).
//
// ⚠ `setTimeout` IS CAPTURED HERE, AT DOCUMENT-START, and handed to the core.
// contextIsolation is off, so the page shares this world: a handler that
// resolved `window.setTimeout` at DROP time — long after page scripts ran —
// could be handed a monkeypatched one that runs the deferred `defaultPrevented`
// read SYNCHRONOUSLY (defeating page-wins) or never (suppressing the
// navigation). Same annoyance class as the `isTrustedGet` capture above, and the
// same honest label: annoyance hardening, not a security boundary — DD6 is what
// makes forgery pointless.
//
// The `isTrusted` capture is deliberately NOT used to REFUSE a scripted drop
// here (deviation recorded in the flight log): the payload is bare, main gates
// on a chrome-declared drag and CONSUMES that declaration on the first forward,
// so a fabricated event buys a page at most the navigation the operator was
// already performing — while refusing untrusted events would also make this
// leg's own AC1 autonomous verification (driving the finished chain with a
// synthetic DragEvent, the way leg 3 verified its chain) impossible.
// ---------------------------------------------------------------------------
const nativeSetTimeout = (() => {
  try {
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      return window.setTimeout.bind(window); // bound: a detached Window operation throws
    }
  } catch {
    /* fall through to the module-scope binding */
  }
  return setTimeout;
})();

if (typeof window !== 'undefined') {
  const bookmarkDrop = createBookmarkDropListeners({ ipcRenderer, setTimeout: nativeSetTimeout });
  window.addEventListener('dragover', bookmarkDrop.handleDragOver);
  window.addEventListener('drop', bookmarkDrop.handleDrop);
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

// ---------------------------------------------------------------------------
// window.close() interception (issue #119). Electron routes a guest page's
// window.close() to the OWNING BaseWindow's close() — one page could close the
// whole browser window (and, as the last window, quit the app). WebContents has
// no preventable close event, so the interception lives here: this preload runs
// in the page main world BEFORE any page script, and replacing the binding
// keeps the request from ever reaching Electron's native path. Main owner-routes
// the request to the chrome, which closes only the calling TAB (Chrome parity)
// after applying Chromium's own close-permission gate — script-opened tabs
// (marked chrome-side at createTab) or history.length ≤ 1. The length is
// self-reported and only ever affects the sender's own tab, so a lying page
// gains nothing beyond closing itself. Known residual: a cross-origin subframe
// keeps its own realm's native binding (preload is top-frame-only).
window.close = () => {
  try {
    ipcRenderer.send('guest-window-close', { historyLength: history.length });
  } catch {
    /* ipc unavailable — swallow; never fall back to the native close */
  }
};
