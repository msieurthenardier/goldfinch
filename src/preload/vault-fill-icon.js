'use strict';

// Decorative vault fill-icon subsystem for the guest main-world preload
// (Mission 12, Flight 2 / Flight 5 HAT). Factored OUT of webview-preload.js so
// the icon glyph, placement, focus-gating and the isTrusted-guarded click /
// contextmenu handlers unit-test headlessly against a hand-rolled fake
// `document` — the preload itself cannot be required under `node --test` (its
// top-level `window` / MutationObserver / ipcRenderer side-effects throw in
// plain Node), so the testable core lives here, mirroring vault-fill-fields.js.
//
// F2 SECURITY INVARIANTS PRESERVED HERE (do not weaken):
//   - the icon is DECORATIVE — it holds NO credential/secret; a hostile page
//     removing/faking it gains nothing (DD1);
//   - its click / contextmenu are isTrusted-GUARDED via a captured getter —
//     a scripted iconEl.click() / synthetic dispatch is ignored (DD3);
//   - clicking sends a BARE IPC (`guest-vault-gesture`, no payload) and
//     right-click sends a BARE IPC (`guest-vault-icon-menu`, no payload) — main
//     derives the trusted wcId from the sender; no secret ever enters the DOM.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_ATTR = 'data-goldfinch-vault-lock';

/**
 * Build the decorative lock glyph as an INLINE SVG (never innerHTML, never an
 * emoji — the guest has no emoji font, so `🔒` renders as a tofu box `□`). A
 * ~16px padlock: a currentColor shackle + body inside a light rounded chip, so
 * it stays legible on both light and dark form fields. Carries role="img",
 * aria-label and the `data-goldfinch-vault-lock` marker.
 * @param {any} doc  a `document`-like object exposing createElementNS.
 * @returns {any} the `<svg>` icon element.
 */
function buildVaultLockIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(ICON_ATTR, '');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Fill login from vault');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('focusable', 'false');

  // Shackle (the arc): stroked, no fill.
  const shackle = doc.createElementNS(SVG_NS, 'path');
  shackle.setAttribute('d', 'M8 11 V8 a4 4 0 0 1 8 0 V11');
  shackle.setAttribute('fill', 'none');
  shackle.setAttribute('stroke', 'currentColor');
  shackle.setAttribute('stroke-width', '2');
  shackle.setAttribute('stroke-linecap', 'round');

  // Body (the lock box): filled with currentColor.
  const body = doc.createElementNS(SVG_NS, 'rect');
  body.setAttribute('x', '5');
  body.setAttribute('y', '11');
  body.setAttribute('width', '14');
  body.setAttribute('height', '9');
  body.setAttribute('rx', '2');
  body.setAttribute('fill', 'currentColor');

  // Keyhole (negative space) so the body reads as a lock even at 16px.
  const keyhole = doc.createElementNS(SVG_NS, 'circle');
  keyhole.setAttribute('cx', '12');
  keyhole.setAttribute('cy', '15');
  keyhole.setAttribute('r', '1.4');
  keyhole.setAttribute('fill', 'rgba(255,255,255,0.9)');

  svg.appendChild(shackle);
  svg.appendChild(body);
  svg.appendChild(keyhole);
  return svg;
}

/**
 * A field is a valid anchor only if it's actually rendered — zero-size /
 * display:none honeypots (0×0 rect, or offsetParent null) get NO icon (else a
 * 0×0 icon lands at the page's top-left corner).
 * @param {any} field
 * @returns {any} the field's rect, or null when it must not be anchored.
 */
function isFieldVisible(field) {
  if (!field || typeof field.getBoundingClientRect !== 'function') return null;
  const rect = field.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  if (field.offsetParent === null) return null;
  return rect;
}

/**
 * Build the icon controller. All electron/DOM coupling is injected so the whole
 * subsystem is unit-testable with a fake document/window and a recording
 * ipcRenderer. The preload constructs one controller and wires its handlers.
 *
 * @param {object} deps
 * @param {any} deps.document
 * @param {any} deps.window
 * @param {any} deps.ipcRenderer
 * @param {any} deps.isTrustedGet  captured Event.prototype.isTrusted getter (or null)
 * @param {(doc: any) => Array<{username: any, password: any, form: any}>} deps.findAllLoginFields
 * @param {() => boolean} deps.getEnabled  true iff top-frame AND vault-eligible
 * @param {() => number} [deps.now]  clock for the gesture-target TTL (default Date.now).
 */
function createVaultIconController({
  document: doc,
  window: win,
  ipcRenderer,
  isTrustedGet,
  findAllLoginFields,
  getEnabled,
  now,
}) {
  const clock = typeof now === 'function' ? now : Date.now;
  // The password field the user's LAST trusted lock-icon gesture targeted, bound
  // for the round-trip to the chrome-owned picker and back (PR#112 finding 9). The
  // fill is delivered on `vault-fill`; the preload consumes THIS to fill the clicked
  // form's field rather than the document's first. SINGLE-USE (cleared on consume)
  // and TTL-bounded so a stale binding can never redirect a much-later / unrelated
  // fill — an expired/absent binding falls back to the first-field heuristic. Held
  // guest-side because contextIsolation is off (the guest already round-trips the
  // gesture): a main-side token would be no more trustworthy and adds no security —
  // this is fill-target INTEGRITY for the user's own page, not a cross-process secret.
  /** @type {{ password: any, expiresAt: number } | null} */
  let pendingFillTarget = null;
  const FILL_TARGET_TTL_MS = 60 * 1000;

  // Resolve the password field to fill for a focused anchor (username OR password
  // of a detected login form): find the entry the anchor belongs to and take its
  // password field. Null when the anchor is not part of any detected login entry.
  function passwordForAnchor(anchor) {
    if (!anchor) return null;
    for (const entry of findAllLoginFields(doc)) {
      if (entry.password === anchor || entry.username === anchor) return entry.password || null;
    }
    return null;
  }

  /**
   * Consume the pending gesture fill-target (single-use, TTL-checked). Returns the
   * bound password field when still valid, else null (the fill falls back to the
   * first-field heuristic). Always clears the binding.
   * @returns {any}
   */
  function consumeFillTarget() {
    const t = pendingFillTarget;
    pendingFillTarget = null;
    if (!t) return null;
    if (clock() > t.expiresAt) return null;
    return t.password;
  }
  // Every injected icon node is tracked so the MEDIA observer can filter out
  // icon-only DOM/style mutations before scheduleScan — otherwise appending an
  // icon (childList) and positioning it via `.style` would re-fire the media
  // rescan forever (HIGH — DD3 feedback loop).
  const iconNodes = new WeakSet();
  // Icons currently in the DOM, for pruning (WeakSet isn't iterable). Each icon
  // carries `_anchor` (the FIELD it decorates) for reverse lookup.
  const placedIcons = new Set();
  // anchor (login field) → icon element, so re-scans reposition rather than
  // stack. WeakMap keys are DOM nodes → a removed field can be GC'd.
  const iconByAnchor = new WeakMap();

  // The login field (username OR password) that currently has focus. The icon
  // is shown ONLY for this field and hidden the moment focus leaves it.
  let focusedField = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let iconTimer = null;

  // Read the GENUINE isTrusted via the captured getter (contextIsolation is off,
  // so a hostile page can override Event.prototype's getter). Annoyance-hardening
  // only: a determined page can raise the prompt but can NEVER complete a
  // chrome-owned fill (DD1/DD3).
  const readTrusted = (e) => (isTrustedGet ? isTrustedGet.call(e) : e.isTrusted);

  function onIconClick(e) {
    if (!readTrusted(e)) return; // scripted iconEl.click() / synthetic dispatch → ignored
    // Bind the CLICKED form's password field for the fill round-trip (finding 9) so the
    // eventual `vault-fill` lands on THIS form, not the document's first. The icon's anchor
    // (`_anchor`, set at placement) is the focused username/password field it decorates.
    const anchor = (e && e.currentTarget && e.currentTarget._anchor) || focusedField;
    const password = passwordForAnchor(anchor);
    pendingFillTarget = password ? { password, expiresAt: clock() + FILL_TARGET_TTL_MS } : null;
    try {
      ipcRenderer.send('guest-vault-gesture', {}); // NO secret — wcId derived in main
    } catch {
      /* page navigated away mid-click */
    }
  }

  // Right-click on the decorative fill icon (I8): request the NATIVE main-process
  // context menu, never a guest-DOM menu. preventDefault() suppresses BOTH the OS
  // default menu AND the app's page-context sheet; stopPropagation keeps a hostile
  // page's bubble-phase listeners from observing it. Same captured-isTrusted guard
  // as onIconClick. The IPC is BARE — main derives the trusted wcId from the sender.
  function onIconContextMenu(e) {
    if (!readTrusted(e)) return; // synthetic/scripted contextmenu → ignored (no menu)
    e.preventDefault();
    e.stopPropagation();
    try {
      ipcRenderer.send('guest-vault-icon-menu'); // NO payload — wcId derived in main
    } catch {
      /* page navigated away mid-gesture */
    }
  }

  // Show-on-focus subtlety: a naive blur→hide would remove the icon before the
  // click lands. mousedown on the icon preventDefault()s so pressing the icon
  // does NOT blur the field — focus is retained, no focusout fires, and the
  // click still reaches onIconClick. (The deferred focusout hide below is the
  // belt-and-suspenders half.)
  function onIconMouseDown(e) {
    e.preventDefault();
  }

  function createIcon() {
    const el = buildVaultLockIcon(doc);
    const s = el.style;
    s.position = 'absolute';
    s.zIndex = '2147483647';
    s.cursor = 'pointer';
    s.boxSizing = 'border-box';
    s.width = '16px';
    s.height = '16px';
    // Light chip + dark glyph reads on both light AND dark form fields.
    s.color = '#3c4043';
    s.background = 'rgba(255,255,255,0.9)';
    s.border = '1px solid rgba(0,0,0,0.2)';
    s.borderRadius = '3px';
    s.userSelect = 'none';
    s.pointerEvents = 'auto';
    el.addEventListener('mousedown', onIconMouseDown);
    el.addEventListener('click', onIconClick);
    el.addEventListener('contextmenu', onIconContextMenu);
    return el;
  }

  function positionIcon(icon, rect) {
    const top = rect.top + (win.scrollY || 0) + (rect.height - 16) / 2;
    const left = rect.left + (win.scrollX || 0) + rect.width - 20;
    icon.style.top = `${Math.max(0, top)}px`;
    icon.style.left = `${Math.max(0, left)}px`;
  }

  // True iff a mutation is purely icon bookkeeping (icon append/remove, or an
  // icon's own style/attr change) — such mutations must NOT trigger the media rescan.
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

  // The set of anchorable login fields (username + password of every detected
  // login form). Both fields carry the icon (problem 2); each is its own anchor.
  function loginFieldSet() {
    const set = new Set();
    for (const entry of findAllLoginFields(doc)) {
      if (entry.username) set.add(entry.username);
      if (entry.password) set.add(entry.password);
    }
    return set;
  }

  // Place / reposition the icon for the currently focused login field (if any),
  // and prune every other icon. Called on focus changes AND by the media
  // observer / scroll-resize reflow so the shown icon tracks layout.
  function placeVaultIcons() {
    if (!getEnabled()) return;
    const parent = doc.body || doc.documentElement;
    if (!parent) return;

    const activeAnchors = new Set();
    if (focusedField && loginFieldSet().has(focusedField)) {
      const rect = isFieldVisible(focusedField);
      if (rect) {
        activeAnchors.add(focusedField);
        let icon = iconByAnchor.get(focusedField);
        if (!icon || !icon.isConnected) {
          icon = createIcon();
          icon._anchor = focusedField;
          iconByAnchor.set(focusedField, icon);
          iconNodes.add(icon);
          placedIcons.add(icon);
          parent.appendChild(icon);
        }
        positionIcon(icon, rect);
      }
    }

    // Prune icons whose field lost focus / vanished / went non-visible this pass.
    for (const icon of placedIcons) {
      if (!activeAnchors.has(icon._anchor)) {
        icon.remove();
        placedIcons.delete(icon);
        iconByAnchor.delete(icon._anchor);
      }
    }
  }

  function scheduleIconPlacement(delay = 300) {
    if (!getEnabled()) return;
    clearTimeout(iconTimer);
    iconTimer = setTimeout(placeVaultIcons, delay);
  }

  // focusin: if focus landed on a detected login field, show ITS icon (and hide
  // any other). If it landed anywhere else, hide all icons.
  function handleFocusIn(e) {
    if (!getEnabled()) return;
    const target = e && e.target;
    focusedField = (target && loginFieldSet().has(target)) ? target : null;
    placeVaultIcons();
  }

  // focusout: hide the field's icon, but DEFER it — a click on the icon keeps
  // focus (mousedown preventDefault) so focusout usually never fires for that
  // gesture; the deferral guards the residual case (browser blur-to-nothing)
  // without eating a click. If focus has since moved to another login field,
  // that field's focusin already re-placed, so we no-op.
  function handleFocusOut(e) {
    if (!getEnabled()) return;
    const target = e && e.target;
    setTimeout(() => {
      if (focusedField === target) {
        focusedField = null;
        placeVaultIcons();
      }
    }, 0);
  }

  return {
    placeVaultIcons,
    scheduleIconPlacement,
    isIconOnlyMutation,
    handleFocusIn,
    handleFocusOut,
    consumeFillTarget,
  };
}

module.exports = { SVG_NS, ICON_ATTR, buildVaultLockIcon, isFieldVisible, createVaultIconController };
