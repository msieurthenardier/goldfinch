'use strict';

// Injected into every web page rendered in a guest WebContentsView tab (wired
// as the web-branch tab's webPreferences.preload, running in the page main
// world). Walks the DOM, collects every piece of media (images, video, audio,
// embeds), and streams the catalog up to the browser UI via ipcRenderer.send
// ('guest-media-list'). (Filename retained for history; the tab is a
// WebContentsView, not a <webview> element.)

const { ipcRenderer, webFrame } = require('electron');
const { findAllLoginFields } = require('./vault-fill-fields');
const { findAllCardFields } = require('./vault-card-fields');
const { findAllIdentityFields, IDENTITY_ROLES } = require('./vault-identity-fields');
const { createVaultIconController } = require('./vault-fill-icon');
const { createEntryTracker, resolveTargetForAnchor } = require('./vault-entry-tracker');
const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT } = require('./vault-entry-observer-bundle.generated');
const {
  isCaptureGesture,
  resolveGestureTargets,
  resolveOrdinalInFamily,
  LOGIN_ROLES,
  CARD_ROLES
} = require('./vault-gesture-policy');
const { planCaptures } = require('./vault-capture-plan');
const { createGestureDetachWatch } = require('./vault-gesture-detach-watch');
const { createBookmarkDropListeners } = require('./guest-bookmark-drop');
const { tabBoundary } = require('../shared/tab-boundary');

// The isolated-world id the entry-tracker's observer is installed into (Mission
// 21, Flight 1, Leg 3, DD3f/DD3g — see vault-entry-observer-bootstrap.js). No
// other isolated-world consumer exists anywhere in this app today (grep-verified
// at design time) — a future second isolated-world consumer MUST pick a
// different id deliberately, never reuse this one.
const VAULT_ENTRY_OBSERVER_WORLD_ID = 745821;

// ---------------------------------------------------------------------------
// Badging API removal (squawk 0062). Chromium exposes navigator.setAppBadge /
// clearAppBadge to every secure-context page, and Electron forwards the call
// straight to the APP-level badge — a Windows taskbar overlay, the macOS dock
// badge, the Unity launcher count — with no prompt and no permission string
// (neither session permission handler is consulted, so session-runtime.js's
// allowlist cannot deny it). In Chrome the call marks an installed PWA's own
// icon; here it landed on Goldfinch's icon and session restore made it persist
// across relaunch (Telegram Web's unread count was the live case). Chromium has
// no runtime feature for it (`--disable-blink-features=Badging` is a no-op —
// verified live), so the methods are deleted from Navigator.prototype at module
// top, before any page script runs (contextIsolation:false — this file is the
// page's first script). WebIDL operations are configurable, so `delete` works
// and the page cannot restore them from this realm.
//
// Best-effort deny, NOT a security boundary: the preload runs in the top frame
// only (nodeIntegrationInSubFrames is off), so a page can still reach a fresh
// Navigator.prototype through any iframe's realm, and Electron also binds the
// badge service for service workers. Every real-world caller badges from its
// top-level document, which this closes; a structural gate needs an Electron
// change (a permission check in front of BadgeService). Pinned by
// test/unit/badging-preload-pin.test.js.
// ---------------------------------------------------------------------------
for (const name of ['setAppBadge', 'clearAppBadge']) {
  try {
    delete Navigator.prototype[name];
  } catch {
    // Not configurable in this build — nothing further to do here.
  }
}

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
  findAllIdentityFields,
  getEnabled: () => vaultEligible && IS_TOP_FRAME,
  getVaultLocked: () => vaultLocked,
  // Shared entry-resolution walk (M21 F1 Leg 3, DD3g "same pure module, two
  // execution contexts") — decorative icon placement stays main-world, using
  // the SAME resolution logic capture will use inside the isolated world.
  resolveTarget: (anchor) =>
    resolveTargetForAnchor(document, anchor, { findAllLoginFields, findAllCardFields, findAllIdentityFields })
});

// The entry tracker (Mission 21, Flight 1, Leg 3 — entry-tracker, DD3f/DD3g/
// DD3h): the main-world POLICY half of the DD3f/DD3g hybrid. `execInWorld` wraps
// the one Electron call this leg adds to this file — everything else about the
// tracker is Electron-free and unit-tested directly. Constructed unconditionally
// (cheap — no side effect until ensureInstalled()/fillLogin()/fillCard() are
// actually called) so its shape matches vaultIcons' own construction style above;
// installation and fill-routing are gated below, same as the icon listeners.
const entryTracker = createEntryTracker({
  execInWorld: (script) => webFrame.executeJavaScriptInIsolatedWorld(VAULT_ENTRY_OBSERVER_WORLD_ID, [{ code: script }]),
  installScript: VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT,
  // Fail closed and NOT silent (DD3h): a systemic, indefinite outage of the
  // whole feature must be diagnosable rather than discovered months later. This
  // preload has no logger reachable without new main-side IPC plumbing (out of
  // this leg's Files Affected), so the diagnostic goes to the guest's own
  // devtools console — visible to whoever opens it, never silently dropped.
  warn: (message) => {
    try {
      console.warn('[goldfinch]', message);
    } catch {
      /* console unavailable in some exotic embedding — nothing further to do */
    }
  }
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
  // Install the isolated-world observer EAGERLY, not lazily on first fill
  // (Implementation Guidance 3): DD3's provenance model grants at TYPE time, so
  // an operator who types-then-submits with no explicit fill gesture at all
  // still needs a running observer from as early as possible. Fire-and-forget —
  // ensureInstalled() never rejects; a failure warns once and leaves every
  // field reporting unprovenanced (DD3h), never throws into this load path.
  // The install-timing race (a keystroke landing before this resolves) fails
  // closed — a possible missed capture, never forged provenance — and is
  // spent against DD4's wrong-moment budget (named in the leg's Edge Cases).
  entryTracker.ensureInstalled();
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

// Vault fill (M12 F1 Leg 4; routed in-world M21 F1 Leg 3, DD3h; ordinal
// precision restored M21 F3 Leg 3, DD9): the main→preload credential-injection
// channel. The resolved credential arrives ONLY here (never over the MCP wire)
// and is filled into the TOP-FRAME login form; fillLoginForm (now running
// INSIDE the isolated world, not here) guards `window.top === window`, and
// webContents.send targets the main frame, so a cross-origin iframe is never
// filled. page JS cannot register a rogue 'vault-fill' listener — the guest
// runs nodeIntegration:false, so it has no ipcRenderer (DD7).
// The fill itself executes in the isolated world (DD3h: fill and grant happen
// in ONE realm, so there is no main-world-node-identity-crosses-the-boundary
// correlation problem to solve). `consumeFillTarget('login')`'s bound field
// (PR#112 finding 9) is now resolved to an INTEGER ordinal via the SAME
// `resolveOrdinalInFamily` the capture gesture already uses (DD9 — no new
// helper) — an integer crosses the isolated-world boundary freely, unlike the
// node reference DD3g forbids — and passed alongside the credential. A
// null/stale/out-of-range ordinal falls back to fillLoginForm's own
// first-detected-entry behaviour (the same path MCP/no-gesture fills use).
ipcRenderer.on('vault-fill', (_e, cred) => {
  const target = vaultIcons.consumeFillTarget('login');
  const ordinal = resolveOrdinalInFamily(target, findAllLoginFields(document), LOGIN_ROLES);
  entryTracker.fillLogin({ cred, ordinal });
});

// Vault CARD fill (issue #152; routed in-world M21 F1 Leg 3, DD3h; ordinal
// precision M21 F3 Leg 3, DD9): the card twin of `vault-fill`. Same trust
// shape — the resolved card arrives ONLY here (never over the MCP wire, which
// stays login-only) and is filled into the TOP-FRAME card form inside the
// isolated world; `fillCardForm` there guards `window.top === window` and
// `webContents.send` targets the main frame, so a cross-origin iframe is
// never filled. Same ordinal-resolution shape as the login path above.
ipcRenderer.on('vault-fill-card', (_e, card) => {
  const target = vaultIcons.consumeFillTarget('card');
  const ordinal = resolveOrdinalInFamily(target, findAllCardFields(document), CARD_ROLES);
  entryTracker.fillCard({ card, ordinal });
});

// Vault IDENTITY fill (M21 F3 Leg 3, DD7/DD8/DD9): the identity twin of
// `vault-fill`/`vault-fill-card`. The resolved identity arrives ONLY here
// (never over the MCP wire, which stays login-only per DD7) and is filled
// into the TOP-FRAME identity form inside the isolated world; `fillIdentityForm`
// there guards `window.top === window`. Same ordinal-resolution shape as the
// other two families — `consumeFillTarget('identity')`'s bound field is always
// the entry's postal anchor (DD8: `targetForAnchor` resolves either of the
// entry's two icon fields to the postal anchor), which is itself one of the
// eleven `IDENTITY_ROLES` fields, so `resolveOrdinalInFamily`'s step 1 always
// resolves for a real gesture.
ipcRenderer.on('vault-fill-identity', (_e, identity) => {
  const target = vaultIcons.consumeFillTarget('identity');
  const ordinal = resolveOrdinalInFamily(target, findAllIdentityFields(document), IDENTITY_ROLES);
  entryTracker.fillIdentity({ identity, ordinal });
});

// Generate-in-picker fill (Mission 21, Flight 4, Leg 3 — generate-in-picker,
// DD7): the two main-generated candidate passwords arrive ONLY here (never
// over the MCP wire — generation is not exposed there at all). Same
// ordinal-resolution shape as the three families above — a LOGIN target
// (the badge is only ever offered on a password field's own icon), resolved
// via the same `resolveOrdinalInFamily`/`LOGIN_ROLES` this file already uses
// for `vault-fill`. The fill itself (which of `new`/`confirm` to write, and
// which candidate to choose against the field's `pattern`) runs entirely in
// the isolated world's `fillGeneratedForm` — this listener never reads a
// field or a candidate itself.
ipcRenderer.on('vault-fill-generated', (_e, { candidates } = {}) => {
  const target = vaultIcons.consumeFillTarget('login');
  const ordinal = resolveOrdinalInFamily(target, findAllLoginFields(document), LOGIN_ROLES);
  entryTracker.fillGenerated({ candidates, ordinal });
});

// ---------------------------------------------------------------------------
// Vault capture — BROADENED GESTURE trigger (Mission 21, Flight 1, Leg 5 —
// broadened-capture). Supersedes the old capturing `submit` listener
// ENTIRELY (removed, not left running alongside this — a real form submit is
// now just one of several qualifying gestures, and leaving both active would
// double-fire and reintroduce the `e.target` / bare-`.value` reads the flight
// log flagged as carrying both spoof classes DD1/DD3 close).
//
// GESTURE (DD1/DD3): a trusted click on any button-like element, or a trusted
// Enter while focus is in a tracked-field-shaped element — classified by the
// pure `vault-gesture-policy` module. The motivating shape this closes: a
// submit control OUTSIDE every form, carrying NO `type` attribute, wired to a
// JS click handler (see checkout-submit-outside-form.html in the fixture
// corpus). `isTrusted` is read through the SAME captured native getter
// (`isTrustedGet`) the fill-icon controller already uses — never the
// live/possibly-overridden property — before the event is handed to the
// classifier; `event.target`/`event.key` are read bare here, which is safe
// because they feed ONLY ordinal resolution (which detected entry a gesture
// maps to), never a VALUE — a spoofed target can misdirect which real entry
// gets read, never fabricate what is read (DD4's wrong-moment budget, never a
// hard zero; see vault-gesture-policy.js's own header).
//
// READ AT GESTURE, RELEASE AT SETTLE (DD3f, corrected at Leg 5 design
// review): `entryTracker.readSnapshot()` is a SAME-PROCESS `webFrame` call
// into the isolated world, issued HERE, synchronously in response to the
// gesture, while the current document's isolated world and its provenance
// map are still alive — never at settle, when `did-navigate` has already
// fired AFTER the new document committed and the old world is gone. The
// three-state snapshot (DD3h) is filtered down to the ONE resolved entry and
// sent to main over `guest-vault-capture` / `guest-vault-capture-card`, which
// HOLDS it pending settle (a navigation commit, main-side, or a reported
// field detachment below) — this file never disposes anything itself, and an
// entry with no provenanced secret value is not even worth sending.
// ---------------------------------------------------------------------------
if (IS_TOP_FRAME && vaultEligible) {
  // Main-world node references for the CURRENT pending gesture's resolved
  // entry(ies), watched for detachment (DD4's SPA settle signal — a flow that
  // removes its fields without ever navigating). Spoofable (main-world), which
  // DD4 itself accepts: a forged/early detachment can only release data main
  // ALREADY HOLDS, sooner — never fabricate a value. M21 F3 L2 (DD1's amendment /
  // LD1): PER-FAMILY now — a login hold and a card hold on the SAME tab each
  // watch their OWN field set, so a second family's gesture no longer silently
  // drops the first family's detach signal. The kind-keyed arm/clear/fire state
  // machine itself lives in the extracted, unit-tested `vault-gesture-detach-
  // watch.js` (AC10) — this file supplies only the thin real-DOM +
  // `ipcRenderer` wiring (the injected `MutationObserver`, the live document
  // root, and the settle IPC send).
  function reportGestureSettle() {
    try {
      ipcRenderer.send('guest-vault-gesture-settle');
    } catch {
      /* page navigated away mid-report */
    }
  }

  const gestureDetachWatch = createGestureDetachWatch({
    MutationObserver: typeof MutationObserver === 'function' ? MutationObserver : undefined,
    root: () => document.documentElement,
    onSettle: reportGestureSettle
  });

  /**
   * @param {'login' | 'card' | 'identity'} kind
   * @param {any[]} fields
   */
  function armGestureDetachWatch(kind, fields) {
    gestureDetachWatch.arm(kind, fields);
  }

  // (Leg 6 — gesture-holds-every-family, LD2/AC4c) ALL per-family decision
  // logic — the entry lookup, the value-layer gate, the payload encoding, the
  // watch-field list — now lives in the pure, unit-tested
  // `vault-capture-plan.js`. This function is reduced to exactly four steps:
  // resolve the list of resolving families, read the isolated-world snapshot
  // ONCE, build the plan, and loop over it sending + arming. There is no
  // `return` inside the loop body — the property "one family's own outcome
  // never affects another's" is proven by `planCaptures`' own unit tests
  // (AC4) and its neuter-verification (AC4b), not by reading this function.
  async function onCaptureGesture(target) {
    if (!target) return;
    // The ordinal needs its OWN main-world detection pass (Leg 5 Implementation
    // Guidance 1b) — the resolveTargetForAnchor split-context precedent:
    // decorative icon resolution stays main-world, capture resolution moves
    // into the isolated world; THIS pass exists only to compute integer
    // ordinals, never to read a value.
    const logins = findAllLoginFields(document);
    const cards = findAllCardFields(document);
    const identities = findAllIdentityFields(document);
    const resolved = resolveGestureTargets(target, { logins, cards, identities });
    if (resolved.length === 0) return;

    let snapshot;
    try {
      snapshot = await entryTracker.readSnapshot();
    } catch {
      return; // fail closed — no hold, no offer
    }

    const plan = planCaptures({
      resolved,
      entriesByKind: { login: logins, card: cards, identity: identities },
      snapshot
    });

    for (const c of plan) {
      try {
        ipcRenderer.send(c.channel, c.payload);
        armGestureDetachWatch(c.kind, c.watchFields);
      } catch {
        /* page navigated away mid-send for THIS family — nothing was held for
           it, nothing to release; every other family in the plan still sends */
      }
    }
  }

  /**
   * Read `isTrusted` through the SAME captured native getter as the rest of
   * this file, then hand the event's shape (never the value-bearing fields) to
   * the pure classifier.
   * @param {any} e
   */
  function handleGestureEvent(e) {
    const isTrusted = isTrustedGet ? isTrustedGet.call(e) : e.isTrusted;
    if (!isCaptureGesture({ type: e.type, isTrusted, target: e.target, key: e.key })) return;
    onCaptureGesture(e.target);
  }

  document.addEventListener('click', handleGestureEvent, true);
  document.addEventListener('keydown', handleGestureEvent, true);
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
