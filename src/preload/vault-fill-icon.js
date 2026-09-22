'use strict';

// Decorative vault fill-icon subsystem for the guest main-world preload
// (Mission 12, Flight 2 / Flight 5 HAT; the glyph itself redesigned Mission 21
// Flight 4 Leg 4 — goldfinch-badge, DD9). Factored OUT of webview-preload.js so
// the icon glyph, placement, focus-gating and the isTrusted-guarded click /
// contextmenu handlers unit-test headlessly against a hand-rolled fake
// `document` — the preload itself cannot be required under `node --test` (its
// top-level `window` / MutationObserver / ipcRenderer side-effects throw in
// plain Node), so the testable core lives here, mirroring vault-fill-fields.js.
//
// The glyph is a small Goldfinch-mark disc (bird silhouette, unchanged across
// lock states) with a lock-state overlay in the bottom-right corner (closed/
// amber when locked, open/green when unlocked) — see `buildVaultLockIcon`'s
// own doc comment for the shape breakdown.
//
// F2 SECURITY INVARIANTS PRESERVED HERE (do not weaken):
//   - the icon is DECORATIVE — it holds NO credential/secret; a hostile page
//     removing/faking it gains nothing (DD1);
//   - its click / contextmenu are isTrusted-GUARDED via a captured getter —
//     a scripted iconEl.click() / synthetic dispatch is ignored (DD3);
//   - clicking sends a BARE IPC (`guest-vault-gesture`, no payload) and
//     right-click sends a BARE IPC (`guest-vault-icon-menu`, no payload) — main
//     derives the trusted wcId from the sender; no secret ever enters the DOM.

// Generate-in-picker gesture payload (Mission 21, Flight 4, Leg 3 —
// generate-in-picker, DD5/AC7): a pure, Electron-free preload module already
// required directly by password-field-roles.test.js and vault-capture-plan.js
// — a plain `require()` here, not an injected dep, matching that precedent.
const { generateGestureInfo } = require('./password-field-roles');

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_ATTR = 'data-goldfinch-vault-lock';

// Glyph colors (drive currentColor → shackle stroke + body fill). Amber when LOCKED
// (an action — unlock — is needed before a fill), green when UNLOCKED (ready to fill).
// Both read on the light chip background AND on light/dark form fields.
const COLOR_LOCKED = '#b06000';
const COLOR_UNLOCKED = '#137333';

/**
 * Build the decorative fill badge as an INLINE SVG (never innerHTML, never an
 * emoji, never a `<use>`/`<image>`/external reference — the guest has no emoji
 * font, so `🔒` renders as a tofu box `□`, and a fetched image would be a new
 * network request from the browser chrome's own preload). The badge is a small
 * Goldfinch-mark disc (Mission 21, Flight 4, Leg 4, DD9) shown IDENTICALLY in
 * both lock states, with a small padlock overlay in the bottom-right corner
 * that carries lock state (closed/amber when locked, open/green when
 * unlocked). Carries role="img", aria-label and the `data-goldfinch-vault-lock`
 * marker.
 *
 * State (the vault lock indicator): the mark (disc, cap, mask, beak, eye) is
 * IDENTICAL between locked and unlocked builds — only the overlay's shackle
 * path changes. When `locked` the shackle is CLOSED (both legs reach the lock
 * body) and the label says the vault must be unlocked; when unlocked the
 * shackle is OPEN (the right leg lifts free of the body) and the label offers
 * the fill. The overlay's color is applied by the controller (createIcon) via
 * the chip's `color` (`currentColor`, unchanged: `COLOR_LOCKED`/`COLOR_UNLOCKED`).
 *
 * `kind` names the ANCHOR's field family ('login' | 'card' | 'identity', issue
 * #152 / M21 F3 Leg 3) and drives the accessible name only — the glyph is
 * identical, and the icon stays decorative and secret-free either way.
 *
 * Every child is a bare presentational shape (`circle`/`path`/`rect`) built via
 * `createElementNS` + `setAttribute`, carrying only geometry/paint attributes
 * (`cx cy r d x y width height rx fill stroke stroke-width stroke-linecap
 * stroke-linejoin`) — never an inline `style` attribute (a new page-unreadable-
 * but-still-new pattern the leg spec calls out to avoid).
 * @param {any} doc  a `document`-like object exposing createElementNS.
 * @param {boolean} [locked]  vault lock state (default true — the safe/closed default).
 * @param {'login'|'card'|'identity'} [kind]  the anchor's field family (default 'login').
 * @returns {any} the `<svg>` icon element.
 */
function buildVaultLockIcon(doc, locked = true, kind = 'login') {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(ICON_ATTR, '');
  svg.setAttribute('role', 'img');
  const noun = kind === 'card' ? 'card' : kind === 'identity' ? 'identity' : 'login';
  // State in the accessible name + a marker attribute (also lets tests/CSS see the state).
  svg.setAttribute('aria-label', locked ? `Unlock vault to fill ${noun}` : `Fill ${noun} from vault`);
  // NOTE: the kind rides the accessible name ONLY — no `data-kind` attribute. The
  // icon's attribute set is pinned by vault-fill-icon.test.js as a "holds nothing a
  // hostile page can read" guard, and a second kind carrier would widen that pin
  // for pure redundancy.
  svg.setAttribute('data-locked', locked ? 'true' : 'false');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('focusable', 'false');

  // --- the Goldfinch mark (disc, cap, mask, beak, eye) — IDENTICAL in both
  // lock states; only the overlay below carries state.

  const disc = doc.createElementNS(SVG_NS, 'circle');
  disc.setAttribute('cx', '12');
  disc.setAttribute('cy', '12');
  disc.setAttribute('r', '10.5');
  disc.setAttribute('fill', '#E8B83A');

  const cap = doc.createElementNS(SVG_NS, 'path');
  cap.setAttribute(
    'd',
    'M5.6 9.4 C6.6 4.9 11.4 3.2 15.6 4.6 C19.4 5.9 21.4 9.8 20.2 14.2 ' +
      'C19.2 11.4 17 9.3 14.3 8.8 C11.2 8.3 8.4 8.6 5.6 9.4 Z'
  );
  cap.setAttribute('fill', '#141414');

  const mask = doc.createElementNS(SVG_NS, 'path');
  mask.setAttribute(
    'd',
    'M5.6 9.4 C8.2 8.5 11.2 8.4 13.4 9.3 C13.8 11.6 12.6 13.9 10.4 15.4 ' + 'C9.2 13.4 7.6 12.1 5.8 11.6 Z'
  );
  mask.setAttribute('fill', '#D7222B');

  const beak = doc.createElementNS(SVG_NS, 'path');
  beak.setAttribute('d', 'M5.8 9.5 L1.2 11.2 L5.9 12.3 Z');
  beak.setAttribute('fill', '#E8B83A');
  beak.setAttribute('stroke', '#141414');
  beak.setAttribute('stroke-width', '0.7');
  beak.setAttribute('stroke-linejoin', 'round');

  const eye = doc.createElementNS(SVG_NS, 'circle');
  eye.setAttribute('cx', '10.2');
  eye.setAttribute('cy', '10.4');
  eye.setAttribute('r', '1.15');
  eye.setAttribute('fill', '#141414');

  // --- the lock-state overlay (backing, shackle, body) — the ONLY part that
  // changes between locked and unlocked builds.

  const overlayBacking = doc.createElementNS(SVG_NS, 'circle');
  overlayBacking.setAttribute('cx', '18.2');
  overlayBacking.setAttribute('cy', '18.2');
  overlayBacking.setAttribute('r', '5.6');
  overlayBacking.setAttribute('fill', '#ffffff');

  // Shackle (the arc): stroked, no fill, currentColor (set by the controller
  // per lock state). CLOSED → both legs reach the lock body (…V17.6); OPEN →
  // the right leg lifts free (no trailing …V17.6), reading as an open hasp.
  const shackle = doc.createElementNS(SVG_NS, 'path');
  shackle.setAttribute(
    'd',
    locked ? 'M16.4 17.6 V15.9 a1.8 1.8 0 0 1 3.6 0 V17.6' : 'M16.4 17.6 V15.9 a1.8 1.8 0 0 1 3.6 0'
  );
  shackle.setAttribute('fill', 'none');
  shackle.setAttribute('stroke', 'currentColor');
  shackle.setAttribute('stroke-width', '1.5');
  shackle.setAttribute('stroke-linecap', 'round');

  // Lock body: filled with currentColor.
  const lockBody = doc.createElementNS(SVG_NS, 'rect');
  lockBody.setAttribute('x', '14.8');
  lockBody.setAttribute('y', '17.4');
  lockBody.setAttribute('width', '6.8');
  lockBody.setAttribute('height', '5');
  lockBody.setAttribute('rx', '1.1');
  lockBody.setAttribute('fill', 'currentColor');

  svg.appendChild(disc);
  svg.appendChild(cap);
  svg.appendChild(mask);
  svg.appendChild(beak);
  svg.appendChild(eye);
  svg.appendChild(overlayBacking);
  svg.appendChild(shackle);
  svg.appendChild(lockBody);
  return svg;
}

/**
 * The fields of a card entry that carry the icon (issue #152). The number,
 * cardholder, combined-expiry and security-code fields — focusing any of them
 * offers the fill, mirroring the login path's both-fields placement. The SPLIT
 * `expMonth`/`expYear` fields are deliberately excluded: they are routinely
 * `<select>`s, where an overlaid icon fights the native dropdown affordance.
 * @param {{ number?: any, cardholder?: any, expiry?: any, csc?: any }} entry
 * @returns {any[]}
 */
function cardAnchorsOf(entry) {
  if (!entry) return [];
  return [entry.number, entry.cardholder, entry.expiry, entry.csc].filter(Boolean);
}

/**
 * The fields of an identity entry that carry the icon (M21 F3 Leg 3, DD8): the
 * scope's postal ANCHOR field and the FIRST non-postal role field in document
 * order — never any other role field. Both are already computed and threaded
 * onto the entry by `vault-identity-fields.js`'s `identityEntryForScope`
 * (`entry.anchor` / `entry.nonPostalAnchor`) — this function never re-derives
 * "first non-postal field" independently, which is exactly the second,
 * driftable derivation DD2/DD8 forbid.
 * @param {{ anchor?: any, nonPostalAnchor?: any }} entry
 * @returns {any[]}
 */
function identityAnchorsOf(entry) {
  if (!entry) return [];
  return [entry.anchor, entry.nonPostalAnchor].filter(Boolean);
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
 * @param {(doc: any) => Array<{number: any, cardholder: any, expiry: any, csc: any, form: any}>} [deps.findAllCardFields]
 *   payment-card entries (issue #152). OPTIONAL: an omitted injection yields no card
 *   anchors, so every pre-card caller keeps its exact prior behavior.
 * @param {(doc: any) => any[]} [deps.findAllIdentityFields]  identity entries
 *   (M21 F3 Leg 3, DD8). OPTIONAL: an omitted injection yields no identity
 *   anchors, so every pre-identity caller keeps its exact prior behavior.
 * @param {() => boolean} deps.getEnabled  true iff top-frame AND vault-eligible
 * @param {() => boolean} [deps.getVaultLocked]  initial vault lock state (default true — locked).
 * @param {() => number} [deps.now]  clock for the gesture-target TTL (default Date.now).
 * @param {(anchor: any) => ({ kind: 'login'|'card'|'identity', field: any } | null)} [deps.resolveTarget]
 *   the shared entry-resolution walk (vault-entry-tracker.js's
 *   resolveTargetForAnchor, M21 F1 Leg 3, DD3g "same pure module, two execution
 *   contexts"). OPTIONAL, with an internal fallback below that is the byte-for-byte
 *   pre-Leg-3 inline walk — every existing createVaultIconController call site
 *   (none of which inject this) keeps its exact prior behavior, which is what
 *   keeps test/unit/vault-fill-icon.test.js passing UNMODIFIED.
 */
function createVaultIconController({
  document: doc,
  window: win,
  ipcRenderer,
  isTrustedGet,
  findAllLoginFields,
  findAllCardFields,
  findAllIdentityFields,
  getEnabled,
  getVaultLocked,
  now,
  resolveTarget
}) {
  const cardEntries = typeof findAllCardFields === 'function' ? findAllCardFields : () => [];
  const identityEntries = typeof findAllIdentityFields === 'function' ? findAllIdentityFields : () => [];
  const clock = typeof now === 'function' ? now : Date.now;
  // Vault lock state driving the icon glyph + color (open/green when unlocked, closed/amber
  // when locked). Seeded from getVaultLocked() (the preload's init query) and updated live via
  // setVaultLocked() (a main push) — the icon must reflect an unlock/lock without a page reload.
  let vaultLocked = typeof getVaultLocked === 'function' ? getVaultLocked() !== false : true;
  // The password field the user's LAST trusted lock-icon gesture targeted, bound
  // for the round-trip to the chrome-owned picker and back (PR#112 finding 9). The
  // fill is delivered on `vault-fill`; the preload consumes THIS to fill the clicked
  // form's field rather than the document's first. SINGLE-USE (cleared on consume)
  // and TTL-bounded so a stale binding can never redirect a much-later / unrelated
  // fill — an expired/absent binding falls back to the first-field heuristic. Held
  // guest-side because contextIsolation is off (the guest already round-trips the
  // gesture): a main-side token would be no more trustworthy and adds no security —
  // this is fill-target INTEGRITY for the user's own page, not a cross-process secret.
  // `kind` distinguishes the login binding (a password field) from the card binding
  // (a card-number field, issue #152) and the identity binding (the postal
  // anchor field, M21 F3 Leg 3) so a `vault-fill`/`vault-fill-card`/
  // `vault-fill-identity` can never consume a target bound by a DIFFERENT
  // family's gesture — the three fill channels resolve against different DOM
  // anchors and a cross-consumption would silently mis-target.
  /** @type {{ kind: 'login'|'card'|'identity', field: any, expiresAt: number } | null} */
  let pendingFillTarget = null;
  const FILL_TARGET_TTL_MS = 60 * 1000;

  // Resolve the fill target for a focused anchor: the password field of the login
  // entry the anchor belongs to, the number field of its card entry, or (DD8,
  // M21 F3 Leg 3) the postal anchor field of its identity entry. Null when the
  // anchor is not part of any detected entry.
  /** @returns {{ kind: 'login'|'card'|'identity', field: any } | null} */
  function targetForAnchor(anchor) {
    if (typeof resolveTarget === 'function') return resolveTarget(anchor);
    if (!anchor) return null;
    for (const entry of findAllLoginFields(doc)) {
      if (entry.password === anchor || entry.username === anchor) {
        return entry.password ? { kind: 'login', field: entry.password } : null;
      }
    }
    for (const entry of cardEntries(doc)) {
      if (cardAnchorsOf(entry).includes(anchor)) {
        return entry.number ? { kind: 'card', field: entry.number } : null;
      }
    }
    for (const entry of identityEntries(doc)) {
      if (identityAnchorsOf(entry).includes(anchor)) {
        return entry.anchor ? { kind: 'identity', field: entry.anchor } : null;
      }
    }
    return null;
  }

  /**
   * Consume the pending gesture fill-target (single-use, TTL-checked). Returns the
   * bound field when still valid, else null (the fill falls back to the first-field
   * heuristic). Always clears the binding — single-use is the security property, so
   * a kind mismatch still burns the target rather than leaving it for a later fill.
   * @param {'login'|'card'|'identity'} [kind]  when given, the binding must match this family.
   * @returns {any}
   */
  function consumeFillTarget(kind) {
    const t = pendingFillTarget;
    pendingFillTarget = null;
    if (!t) return null;
    if (clock() > t.expiresAt) return null;
    if (kind && t.kind !== kind) return null;
    return t.field;
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
    const target = targetForAnchor(anchor);
    pendingFillTarget = target
      ? { kind: target.kind, field: target.field, expiresAt: clock() + FILL_TARGET_TTL_MS }
      : null;
    // Generate-in-picker gesture payload (Mission 21, Flight 4, Leg 3, DD5/AC7):
    // computed ONLY for a resolved LOGIN target — a card/identity/unresolved
    // gesture stays bare ({}), exactly as every gesture did before this leg.
    // The ordinal is the CLICKED entry's own index (there is one
    // findAllLoginFields entry PER password field, so a multi-password scope
    // has one ordinal per field) — never re-derived from `anchor` (which may
    // be the entry's username field, not its password field).
    /** @type {{ generate?: any }} */
    let payload = {};
    if (target && target.kind === 'login') {
      const loginEntries = findAllLoginFields(doc);
      const ordinal = loginEntries.findIndex((entry) => entry.password === target.field);
      if (ordinal !== -1) {
        payload = { generate: generateGestureInfo(loginEntries, ordinal) };
      }
    }
    try {
      ipcRenderer.send('guest-vault-gesture', payload); // NO secret — wcId derived in main
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

  /** @param {'login'|'card'|'identity'} kind */
  function createIcon(kind) {
    const el = buildVaultLockIcon(doc, vaultLocked, kind);
    const s = el.style;
    s.position = 'absolute';
    s.zIndex = '2147483647';
    s.cursor = 'pointer';
    s.boxSizing = 'border-box';
    s.width = '16px';
    s.height = '16px';
    // Light chip; the glyph is color-coded by lock state (amber=locked, green=unlocked) and
    // reads on both light AND dark form fields against the near-white chip.
    s.color = vaultLocked ? COLOR_LOCKED : COLOR_UNLOCKED;
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

  /**
   * Update the vault lock state (a main push after unlock/lock/idle-auto-lock) and, if an
   * icon is currently shown, re-render it so the glyph + color flip WITHOUT a page reload.
   * A no-op when the state is unchanged.
   * @param {boolean} locked
   */
  function setVaultLocked(locked) {
    const next = locked !== false; // bias to LOCKED (safe) on anything but an explicit false
    if (next === vaultLocked) return;
    vaultLocked = next;
    // Drop any placed icon so placeVaultIcons rebuilds it with the new glyph/color.
    for (const icon of placedIcons) {
      icon.remove();
      placedIcons.delete(icon);
      iconByAnchor.delete(icon._anchor);
    }
    placeVaultIcons();
  }

  // Walk up from `startEl` (inclusive) looking for the nearest ancestor whose
  // computed `position` is not `static` — the CSS containing block an icon
  // appended IN-TREE (see placeVaultIcons) would resolve its `position:absolute`
  // against. Stops at body/documentElement WITHOUT checking them (reaching either
  // means "no positioned ancestor" — positionIcon's body-relative fallback already
  // handles that case correctly). Requires `window.getComputedStyle`; callers gate
  // on its presence first (squawk 0072 — a hand-rolled test double that omits it
  // must fall back to the original body-relative behavior wholesale, not throw).
  function nearestPositionedAncestor(startEl) {
    let node = startEl;
    while (node && node !== doc.body && node !== doc.documentElement) {
      const cs = win.getComputedStyle(node);
      if (cs && cs.position && cs.position !== 'static') return node;
      node = node.parentElement || null;
    }
    return null;
  }

  // Position the icon at the field's trailing edge, vertically centered.
  // `ancestor`, when given, is the nearest non-static positioned ancestor of the
  // icon's in-tree parent (nearestPositionedAncestor above) — offsets are relative
  // to ITS border box, minus clientTop/clientLeft (the border width) to land in
  // its padding box, the actual `position:absolute` containing block. Absent an
  // ancestor (none found, or the icon is body-placed), fall back to the original
  // scroll-relative math — which is already correct for a body-placed icon.
  function positionIcon(icon, rect, ancestor) {
    let top;
    let left;
    if (ancestor && typeof ancestor.getBoundingClientRect === 'function') {
      const aRect = ancestor.getBoundingClientRect();
      top = rect.top - aRect.top - (ancestor.clientTop || 0) + (rect.height - 16) / 2;
      left = rect.left - aRect.left - (ancestor.clientLeft || 0) + rect.width - 20;
    } else {
      top = rect.top + (win.scrollY || 0) + (rect.height - 16) / 2;
      left = rect.left + (win.scrollX || 0) + rect.width - 20;
    }
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

  // Every anchorable field mapped to its family: the username + password of each
  // detected login form (both carry the icon — problem 2), the number /
  // cardholder / expiry / csc of each detected card form (issue #152), and
  // (M21 F3 Leg 3, DD8) the postal anchor + first non-postal field of each
  // detected identity entry. Walked login → card → identity so a field somehow
  // claimed by an earlier family resolves there — the same login > card >
  // identity precedence DD5 fixes at detection. This is the site that decides
  // whether an identity icon renders AT ALL (flight DD8 records that the flight
  // spec itself missed this site once).
  /** @returns {Map<any, 'login'|'card'|'identity'>} */
  function anchorKinds() {
    /** @type {Map<any, 'login'|'card'|'identity'>} */
    const kinds = new Map();
    for (const entry of findAllLoginFields(doc)) {
      if (entry.username) kinds.set(entry.username, 'login');
      if (entry.password) kinds.set(entry.password, 'login');
    }
    for (const entry of cardEntries(doc)) {
      for (const field of cardAnchorsOf(entry)) {
        if (!kinds.has(field)) kinds.set(field, 'card');
      }
    }
    for (const entry of identityEntries(doc)) {
      for (const field of identityAnchorsOf(entry)) {
        if (!kinds.has(field)) kinds.set(field, 'identity');
      }
    }
    return kinds;
  }

  // Place / reposition the icon for the currently focused login field (if any),
  // and prune every other icon. Called on focus changes AND by the media
  // observer / scroll-resize reflow so the shown icon tracks layout.
  function placeVaultIcons() {
    if (!getEnabled()) return;
    const bodyOrHtml = doc.body || doc.documentElement;
    if (!bodyOrHtml) return;

    const activeAnchors = new Set();
    const kind = focusedField ? anchorKinds().get(focusedField) : undefined;
    if (focusedField && kind) {
      const rect = isFieldVisible(focusedField);
      if (rect) {
        activeAnchors.add(focusedField);
        // IN-TREE PLACEMENT (squawk 0072): append into the field's OWN
        // parentElement instead of <body>. A body-level icon reads as an
        // OUTSIDE click to a site's dismiss-on-outside-pointerdown drawer/modal
        // (verified live — the page's CAPTURE-phase handler runs before the
        // icon's own stopPropagation could ever help), so clicking the icon
        // silently closed the very form it was meant to fill. Resolving a
        // positioned ancestor needs `window.getComputedStyle`; its absence
        // (only a hand-rolled test double lacks it) falls back to the
        // original body placement + body-relative math wholesale, not a
        // half-migrated state.
        const fieldParent = focusedField.parentElement || null;
        const inTree = !!fieldParent && typeof win.getComputedStyle === 'function';
        const appendTarget = inTree ? fieldParent : bodyOrHtml;
        let icon = iconByAnchor.get(focusedField);
        if (!icon || !icon.isConnected) {
          icon = createIcon(kind);
          icon._anchor = focusedField;
          iconByAnchor.set(focusedField, icon);
          iconNodes.add(icon);
          placedIcons.add(icon);
          appendTarget.appendChild(icon);
        }
        positionIcon(icon, rect, inTree ? nearestPositionedAncestor(fieldParent) : null);
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

  // focusin: if focus landed on a detected login OR card field, show ITS icon (and
  // hide any other). If it landed anywhere else, hide all icons.
  function handleFocusIn(e) {
    if (!getEnabled()) return;
    const target = e && e.target;
    focusedField = target && anchorKinds().has(target) ? target : null;
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
    setVaultLocked
  };
}

module.exports = { SVG_NS, ICON_ATTR, buildVaultLockIcon, isFieldVisible, createVaultIconController };
