// @ts-check
'use strict';

// HTTP auth pending-challenge store (M14 F1 L2, flight DD2/DD3; client-cert
// kind added by L3, flight DD4).
//
// `app.on('login')` and `app.on('select-client-certificate')` each hand main a
// native `callback` that MUST be answered exactly once — an abandoned callback
// hangs the request forever; a double answer throws inside Electron's event
// dispatch. This module owns every such callback under an exactly-once ledger,
// a per-window FIFO queue, and the DD2 two-lifecycle contract. The two
// challenge KINDS ('basic-auth' | 'client-cert') share ONE store and ONE queue
// — the queue semantics are identical; only the presentation menuType/channel
// and the resolution payload differ (see resolveOnce + presentNext):
//
//   RESOLUTION (challenge ends — callback answered):
//     submit / agent answer → callback(user, pass); Esc / outside-click /
//     explicit cancel / tab close / window close / cross-window move /
//     navigation-away / teardown → cancel. The cancel INVOCATION SHAPE is
//     kind-split (M14 F3 HAT fix): basic-auth cancels callback() (zero args,
//     documented); client-cert cancels callback(null) — a zero-arg call on a
//     select-client-certificate callback SIGSEGVs the main process on
//     Electron 43 (see resolveOnce). ANY sheet-close reason not in the
//     occlusion set maps here — the FAIL-SAFE default is resolve-cancel,
//     never a hung callback (unit-pinned).
//   OCCLUSION (challenge survives — sheet hidden, callback still pending):
//     'blur' / 'superseded' / 'tab-hide' / 'tab-switch'. The challenge stays
//     queued and re-presents at the next trigger: tab activation, window
//     refocus, fullscreen exit, or a queue event (a resolution dequeuing the
//     head). That trigger gap is the documented max re-presentation staleness.
//
// KEYING (leg design ruling): the store keys its PRESENTED challenge per window
// record — no token→challengeId map. The sheet's open token stays what it
// already is (the manager/IPC freshness gate); notifySheetClosed and the
// auth-submit handler both carry window identity natively.
//
// POPUPS (M14 F2 L2, DD1a/DD1b as flight-log refined): a challenge arriving
// from a POPUP's contents (Option B BrowserWindow popups) routes popup-registry-
// FIRST — the popup's OWNING WindowRecord (`popupRegistry.getByWcId(wcId)
// .openerRecord`), before getWindowForGuest (which misses popups by
// construction). Popup challenges enqueue on that record's ordinary queue with
// `isPopup: true` and are KIND-AGNOSTIC (basic-auth AND client-cert). Their
// eligibility is INDEPENDENT of `activeTabWcId`, of the opener tab's liveness
// (the registry's tolerated-dead-`openerWcId` seam), and of popup occlusion/
// minimization — a popup is a floating always-visible surface, and the sheet
// renders on the OWNER window, which is what the user interacts with. The
// standard record-level gates (one presented challenge per window, fullscreen
// hold, open-menu hold) still apply. Presentation resolves the owning record's
// OWN chrome directly (`record.chromeView.webContents` — `chromeForTab(popup)`
// misses by construction) and the payload carries `popup: true` for the sheet's
// marker copy line (DD5 — a payload field + template copy, never a new sheet).
// Cancel triggers for popup challenges: popup destroyed (the
// cancelChallengesForPopup seam → cancelForTab 'tab-close'), popup
// navigation-away (guest-wiring's slim popup variant → 'navigated'), opener tab
// moved cross-window (cancel-on-rekey → 'moved', byte-consistent with the tab
// contract — no queue migration), and window teardown (cancelForWindow, whose
// whole-queue sweep needs no popup awareness).
//
// PRESENTATION ELIGIBILITY: the challenge's tab is the window's activeTabWcId
// (or the challenge is a popup challenge — see POPUPS above),
// no other challenge is presented on that window, `record.htmlFullscreen` is not
// set (a challenge arriving mid-fullscreen holds like tab-hidden), AND no sheet
// menu is open (`record.sheet.isMenuOpen()`) — a re-present must never
// model-replace an open menu. Critical pinned case: the dismiss-locked one-time-
// key sheets (vault-recovery-show family) ignore 'blur' but ARE hard-closed by
// 'superseded' — a refocus re-present over one would destroy an unrecoverable
// one-time key. The held challenge waits for the next trigger instead. Closes of
// OTHER menu types are ignored entirely (no re-present-stealing — leg ruling).
//
// House pattern: Electron-free, dependency-injected (registry + chromeForTab +
// logger) — the whole matrix unit-tests offline with fakes.

/**
 * @typedef {{
 *   challengeId: string,
 *   kind: 'basic-auth' | 'client-cert',
 *   record: any,
 *   wcId: number,
 *   host: string,
 *   port?: number | null,
 *   scheme?: string | null,
 *   realm?: string,
 *   url: string,
 *   certSummaries?: { subject: string, issuer: string }[],
 *   list?: any[],
 *   callback: (...args: any[]) => void,
 *   resolved: boolean,
 *   isPopup?: boolean,
 * }} Challenge
 * @typedef {{ queue: Challenge[], presented: Challenge | null }} WindowAuthState
 */

// DD2 bucket sets (unit-pinned). Anything OUTSIDE both sets maps to RESOLUTION
// (fail-safe cancel) — a new close reason can delay a prompt, never leak a
// hung callback.
const OCCLUSION_REASONS = new Set(['blur', 'superseded', 'tab-hide', 'tab-switch']);
const RESOLUTION_REASONS = new Set(['escape', 'outside-click', 'activated', 'tab-close', 'teardown']);

// The store-owned sheet menuTypes, one per challenge kind (M14 F1 L3). BOTH the
// notifySheetClosed filter AND cancelForTab's visible-sheet close read this set
// — a hardcoded 'auth-basic' in either would leave a stale cert-picker open
// across navigation-away (or ignore its close-reason buckets entirely).
const AUTH_MENU_TYPES = new Set(['auth-basic', 'cert-picker']);

/**
 * Display identity for the basic-auth presentation payload (M14 F3 HAT fix,
 * Validator finding D1): `host:port` whenever the challenge carries a port
 * that is NOT the default for the challenge URL's scheme, else the bare host
 * — mainstream-browser rendering; the port disambiguates services sharing a
 * host (two fixtures on 127.0.0.1 must not read identically). Electron's
 * authInfo.host is the bare hostname; the port rides authInfo.port
 * separately, which is why the pre-fix payload dropped it. An unparseable or
 * absent URL keeps the port (fail-informative — when the default-port
 * question can't be answered, showing the port is the safe direction). An
 * IPv6 literal is bracketed before the port is appended (URL.host
 * serialization). Display-only: the queue record keeps raw host + port
 * (getPendingChallenge's agent-seam contract is unchanged). The client-cert
 * sibling is certChallengeHost below — a DIFFERENT derivation (Electron hands
 * that path a bare `host:port` string, not authInfo fields). This path has no
 * same-class exposure: authInfo.host is Chromium's bare hostname (never
 * URL-parsed here — a trailing-dot host rides through verbatim), and the URL
 * parse below only answers the default-port question, failing informative.
 * @param {Challenge} challenge
 * @returns {string}
 */
function displayHost(challenge) {
  const host = challenge.host || '';
  const port = challenge.port;
  if (typeof port !== 'number') return host;
  /** @type {string | null} */
  let protocol = null;
  try {
    protocol = new URL(challenge.url).protocol;
  } catch {
    // unparseable URL — keep the port (fail-informative)
  }
  const isDefaultPort =
    ((protocol === 'http:' || protocol === 'ws:') && port === 80) ||
    ((protocol === 'https:' || protocol === 'wss:') && port === 443);
  if (isDefaultPort) return host;
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${bracketed}:${port}`;
}

/**
 * Display host for a client-cert challenge (M14 F3 HAT fix #7). Electron's
 * `select-client-certificate` passes `url` as the request's BARE `host:port`
 * (Chromium's cert_request_info host_and_port serialization), NOT a full URL
 * — live-verified: `localhost.:8493` presented with NO attribution while
 * `127.0.0.1:8493` displayed. Feeding that form to `new URL()` directly is a
 * trap with a coin-flip failure mode: a letter-leading host ("localhost.",
 * "example.com") is a VALID SCHEME token, so the parse SUCCEEDS with host ""
 * (the subtitle silently vanished); a digit-leading or bracketed host
 * ("127.0.0.1:8493", "[::1]:8493") THROWS, and the old catch-fallback showed
 * the raw string — right by luck. Derivation: a string without "://" is
 * parsed as host:port under a synthetic `https://` base (which also strips a
 * default :443 — displayHost's mainstream-browser parity); a full URL parses
 * directly. ANY empty-host outcome — parse failure OR parseable-but-hostless
 * — falls back to the raw string: never a silent blank. IPv6 bracket forms
 * ride URL.host natively in both branches. Display only, never a secret.
 * @param {any} url
 * @returns {string}
 */
function certChallengeHost(url) {
  const raw = String(url || '');
  if (!raw) return '';
  let host = '';
  try {
    host = new URL(raw.includes('://') ? raw : 'https://' + raw).host;
  } catch {
    // unparseable under both readings — fall back to the raw string below
  }
  return host || raw;
}

/**
 * @param {{ registry: any, chromeForTab: (wcId: number) => any, popupRegistry?: { getByWcId: (wcId: number) => any } | null, logger?: any }} deps
 *   popupRegistry — (M14 F2 L2, DD1b) the popup registry's lookup seam, read
 *   LAZILY per challenge so construction order in main.js is irrelevant.
 *   Absent → no behavior change (offline tests / legacy callers): popup
 *   contents then resolve no record and cancel silently, the pre-leg-2 shape.
 */
function createAuthChallenges({ registry, chromeForTab, popupRegistry = null, logger = console }) {
  /** @type {Map<any, WindowAuthState>} keyed by WindowRecord */
  const states = new Map();
  let seq = 0;

  /** @param {any} record @returns {WindowAuthState} */
  function stateFor(record) {
    let state = states.get(record);
    if (!state) {
      state = { queue: [], presented: null };
      states.set(record, state);
    }
    return state;
  }

  /**
   * THE single callback choke point (exactly-once ledger). Every path that
   * answers an Electron auth callback — submit, agent answer, every cancel,
   * and handleLogin's silent-cancel guards (which mint an unqueued challenge
   * shell) — funnels here; the source-scan pin asserts no other site invokes
   * `challenge.callback`. Resolving dequeues and attempts the next
   * presentation (the "queue event" re-present trigger — a no-op while the
   * sheet is still open, so the answer paths' trailing close re-attempts).
   * @param {Challenge} challenge
   * @param {{ username?: any, password?: any } | { cert: any } | null} resolution
   * @returns {boolean} whether THIS call performed the resolution
   */
  function resolveOnce(challenge, resolution) {
    if (challenge.resolved) return false;
    challenge.resolved = true;
    const cb = challenge.callback;
    try {
      // Kind-aware resolution union (M14 F1 L3): the source-scan pin forbids
      // callback sites outside this ledger, so BOTH kinds' answer shapes live
      // here. basic-auth answers (user, pass) with String coercion; client-cert
      // answers (cert) — the raw Electron Certificate object, main-side only.
      //
      // ⚠️ CANCEL SHAPES DIFFER BY KIND (M14 F3 HAT fix, live-measured on
      // Electron 43): a basic-auth ('login') callback cancels with ZERO args —
      // documented, exercised live. A select-client-certificate callback
      // invoked with ZERO args SIGSEGVs the main process (silent death, no JS
      // error to catch — native argument-count bug); an explicit `cb(null)`
      // takes the intended continue-WITHOUT-certificate path (Chrome-parity
      // cancel: the TLS handshake completes cert-less and the page renders its
      // unauthenticated state). `cb(undefined)` is also wrong (throws "Must
      // pass valid certificate object" and fails the request with
      // ERR_SSL_CLIENT_AUTH_CERT_NEEDED). Cert cancels MUST pass exactly one
      // argument, strictly null — pinned in auth-challenges.test.js.
      if (!resolution) {
        if (challenge.kind === 'client-cert')
          cb(null); // explicit null — NEVER zero-arg (SIGSEGV, see above)
        else cb();
      } else if (challenge.kind === 'client-cert') cb(/** @type {{ cert: any }} */ (resolution).cert);
      else {
        const credential = /** @type {{ username?: any, password?: any }} */ (resolution);
        cb(String(credential.username ?? ''), String(credential.password ?? ''));
      }
    } catch (err) {
      // A throwing native callback must never wedge the queue machinery.
      logger.warn('[auth-challenges] callback threw:', err && (err.message || err));
    }
    const record = challenge.record;
    const state = record ? states.get(record) : null;
    if (state) {
      const idx = state.queue.indexOf(challenge);
      if (idx !== -1) state.queue.splice(idx, 1);
      if (state.presented === challenge) state.presented = null;
      presentNext(record);
    }
    return true;
  }

  /**
   * Present the first eligible queued challenge on this window, if any. All
   * four re-present triggers and every enqueue land here; the eligibility
   * gates make it safe to call unconditionally.
   * @param {any} record
   */
  function presentNext(record) {
    const state = states.get(record);
    if (!state || state.presented) return;
    if (record.htmlFullscreen) return; // holds like tab-hidden; presents on exit
    if (record.sheet?.isMenuOpen?.()) return; // never model-replace an open menu
    if (record.win?.isDestroyed?.()) return;
    // Eligibility (DD1b as flight-log refined): a TAB challenge is eligible only
    // while its tab is the window's active tab; a POPUP challenge is eligible
    // unconditionally at this gate — independent of activeTabWcId, of the opener
    // tab's liveness, and of popup occlusion/minimization (the record-level
    // gates above still hold; the sheet renders on the owner window).
    const next = state.queue.find((c) => c.isPopup === true || c.wcId === record.activeTabWcId);
    if (!next) return; // background-tab challenges hold until their tab activates
    state.presented = next;
    // Chrome-mediated presentation (vault-recovery-show precedent): the chrome
    // opens the sheet through the standard menu-overlay:open path, reusing the
    // bounds snapshot + token discipline. Never a secret: host + realm for
    // basic-auth; host + subject/issuer DISPLAY STRINGS for client-cert (the
    // raw Certificate objects never cross IPC — they stay on the main-side
    // record; selection comes back as an index). Channel choice (M14 F1 L3,
    // flight-logged): a DEDICATED 'cert-challenge-present' send, not a kind
    // field on the existing channel — the per-surface-channel idiom every
    // other sheet trigger uses, and it keeps 'auth-challenge-present's payload
    // contract frozen.
    // Popup presentation (M14 F2 L2, DD1b wall 3): `chromeForTab(popup)` misses
    // by construction (popups are never in tabViews), so a popup challenge
    // resolves the owning record's OWN chrome directly — the record is in hand;
    // guard the destroyed-chrome teardown window. The payload's `popup: true`
    // feeds the sheet templates' marker copy line (DD5) and is ABSENT for tab
    // challenges — both existing payload contracts stay frozen.
    const target =
      next.isPopup === true
        ? record.chromeView?.webContents && !record.chromeView.webContents.isDestroyed?.()
          ? record.chromeView.webContents
          : null
        : chromeForTab(next.wcId);
    const popupField = next.isPopup === true ? { popup: true } : {};
    if (next.kind === 'client-cert') {
      target?.send('cert-challenge-present', {
        wcId: next.wcId,
        host: next.host,
        certs: next.certSummaries,
        ...popupField
      });
    } else {
      target?.send('auth-challenge-present', {
        wcId: next.wcId,
        // host:port display identity (D1 fix — see displayHost): the record's
        // raw host/port stay untouched for the agent read seam.
        host: displayHost(next),
        realm: next.realm,
        ...popupField
      });
    }
  }

  /**
   * `app.on('login')` handler body. The caller has already preventDefault()ed.
   * Guard cancels (proxy / contents-less / internal / non-guest) mint an
   * unqueued challenge shell and route through resolveOnce — the single
   * choke point answers THESE callbacks too (source-scan pinned).
   * @param {any} webContents  may be undefined (utility/contents-less requests)
   * @param {any} details
   * @param {any} authInfo
   * @param {(...args: any[]) => void} callback
   */
  function handleLogin(webContents, details, authInfo, callback) {
    /** @returns {void} */
    const cancelSilently = () => {
      resolveOnce(/** @type {Challenge} */ ({ callback, resolved: false, record: null, kind: 'basic-auth' }), null);
    };
    if (!webContents || typeof webContents.id !== 'number') return cancelSilently();
    if (authInfo && authInfo.isProxy) return cancelSilently(); // no proxy feature (DD2 ruling)
    // Internal-session symmetry with DD4 (practically unreachable, pinned anyway).
    if (webContents.session && webContents.session.__goldfinchInternal === true) return cancelSilently();
    // Popup-registry-FIRST routing (M14 F2 L2, DD1b wall 1): a popup's contents
    // resolve their OWNING record via the registry entry's openerRecord —
    // getWindowForGuest misses popups by construction. Kind-agnostic (the cert
    // ladder below mirrors this).
    const popupEntry = popupRegistry ? popupRegistry.getByWcId(webContents.id) : null;
    const record = popupEntry ? popupEntry.openerRecord : registry.getWindowForGuest(webContents.id);
    // Non-guest contents (chrome, sheet, DevTools, favicon session.fetch) —
    // cancel silently: no prompt spam from background subresources (DD2).
    if (!record) return cancelSilently();
    const state = stateFor(record);
    state.queue.push({
      challengeId: 'auth-' + ++seq,
      kind: 'basic-auth',
      record,
      ...(popupEntry ? { isPopup: true } : {}),
      wcId: webContents.id,
      host: (authInfo && authInfo.host) || '',
      port: authInfo && typeof authInfo.port === 'number' ? authInfo.port : null,
      // NOTE: authInfo.scheme is the AUTH scheme ('basic'), NOT the URL scheme —
      // display/bookkeeping only; origin derivation must use `url` (DD3).
      scheme: (authInfo && authInfo.scheme) || null,
      realm: (authInfo && authInfo.realm) || '',
      url: (details && details.url) || '',
      callback,
      resolved: false
    });
    presentNext(record);
  }

  /**
   * `app.on('select-client-certificate')` handler body (M14 F1 L3, flight DD4
   * as design-review corrected: an APP-level event, routed like 'login'). The
   * caller has already preventDefault()ed. Same routing ladder as handleLogin
   * (null-check, internal exclusion, non-guest cancel) plus a DEFENSIVE
   * empty-list cancel — verified against Electron 43 source: an empty list
   * never reaches the handler (electron_browser_client.cc continues cert-less
   * before emitting the event), so that guard is unreachable-by-construction;
   * pinned anyway. The queue record carries subject/issuer DISPLAY STRINGS for
   * the sheet (certSummaries) and the raw Electron Certificate list MAIN-SIDE
   * ONLY (selection resolves `list[i]` in selectCertFromSheet).
   * @param {any} webContents  may be undefined (utility/contents-less requests)
   * @param {string} url  live form is the request's BARE `host:port` (see certChallengeHost)
   * @param {any[]} list
   * @param {(...args: any[]) => void} callback
   */
  function handleSelectClientCertificate(webContents, url, list, callback) {
    /** @returns {void} */
    const cancelSilently = () => {
      resolveOnce(/** @type {Challenge} */ ({ callback, resolved: false, record: null, kind: 'client-cert' }), null);
    };
    if (!webContents || typeof webContents.id !== 'number') return cancelSilently();
    // Internal-session symmetry with handleLogin (DD4: exclusion via the
    // session marker, not the onSessionCreated seam).
    if (webContents.session && webContents.session.__goldfinchInternal === true) return cancelSilently();
    // Popup-registry-FIRST routing — the kind-agnostic mirror of handleLogin's
    // ladder (M14 F2 L2: the popup contract applies to BOTH challenge kinds).
    const popupEntry = popupRegistry ? popupRegistry.getByWcId(webContents.id) : null;
    const record = popupEntry ? popupEntry.openerRecord : registry.getWindowForGuest(webContents.id);
    // Non-guest contents — cancel silently (no prompt spam), like handleLogin.
    if (!record) return cancelSilently();
    // Defensive-unreachable (doc above): the live no-cert expectation is
    // "no event, no sheet, page loads unauthenticated".
    if (!Array.isArray(list) || list.length === 0) return cancelSilently();
    // Display attribution host. `url` arrives as BARE host:port live (fix #7
    // — certChallengeHost's derivation-trap doc); naive new URL() here blanked
    // the sheet's site attribution for every letter-leading hostname.
    const host = certChallengeHost(url);
    const state = stateFor(record);
    state.queue.push({
      challengeId: 'cert-' + ++seq,
      kind: 'client-cert',
      record,
      ...(popupEntry ? { isPopup: true } : {}),
      wcId: webContents.id,
      host,
      url: String(url || ''),
      certSummaries: list.map((c) => ({
        subject: String((c && c.subjectName) || ''),
        issuer: String((c && c.issuerName) || '')
      })),
      list,
      callback,
      resolved: false
    });
    presentNext(record);
  }

  /**
   * Resolution-family invalidation for one tab OR POPUP: navigation-away, tab/
   * popup close, cross-window move (for popups: the opener tab's cancel-on-rekey
   * — 'moved', tab parity). Cancels every pending challenge for that wcId (all
   * windows scanned — the store's own bookkeeping is the authority, immune to
   * registry timing around teardown) and closes a visible auth sheet that was
   * showing one of them. This is also `cancelChallengesForPopup`'s whole body:
   * main.js's DD1f seam is a thin delegation here with reason 'tab-close' — a
   * popup challenge lives on its owning record's ordinary queue keyed by the
   * popup's wcId, so the scan needs no popup awareness.
   * @param {number} wcId
   * @param {string} reason  'navigated' | 'tab-close' | 'moved'
   */
  function cancelForTab(wcId, reason) {
    for (const [record, state] of states) {
      const hits = state.queue.filter((c) => c.wcId === wcId);
      if (hits.length === 0) continue;
      const wasPresented = state.presented != null && state.presented.wcId === wcId;
      for (const c of hits) resolveOnce(c, null);
      if (wasPresented) {
        const cur = record.sheet?.getCurrentMenu?.();
        if (cur && AUTH_MENU_TYPES.has(cur.menuType)) {
          // Resolution-family close, EITHER challenge sheet (AUTH_MENU_TYPES —
          // a hardcoded 'auth-basic' would leave a stale cert-picker open on
          // navigation-away); the trailing notifySheetClosed re-resolve is an
          // exactly-once no-op and re-attempts the next presentation.
          record.sheet.closeMenuOverlay(reason === 'navigated' ? 'navigation' : 'tab-close');
        }
      }
    }
  }

  /**
   * Window close / teardown: cancel the WHOLE queue, not just the presented
   * head (load-bearing — the sheet's own 'teardown' close only ever names the
   * presented challenge). Drops the window's state entry.
   * @param {any} record
   */
  function cancelForWindow(record) {
    const state = states.get(record);
    if (!state) return;
    states.delete(record); // presentNext resolves nothing for this record from here on
    state.presented = null;
    const pending = [...state.queue];
    state.queue.length = 0;
    for (const c of pending) resolveOnce(c, null);
  }

  /**
   * Manager close-observer sink (both emit paths: closeMenuOverlay AND the
   * openMenu model-replace 'superseded' branch). Maps the close reason to its
   * DD2 bucket. Closes of menus other than 'auth-basic' are ignored entirely.
   * @param {any} record
   * @param {string} menuType
   * @param {string} reason
   */
  function notifySheetClosed(record, menuType, reason) {
    if (!AUTH_MENU_TYPES.has(menuType)) return; // other menus: no re-present-stealing (ruling)
    const state = states.get(record);
    if (!state) return;
    if (OCCLUSION_REASONS.has(reason)) {
      // Challenge survives: back to (still in) the queue; re-presents at the
      // next trigger. RESOLUTION_REASONS is enumerated for the pin; everything
      // else falls through to the fail-safe cancel below.
      state.presented = null;
      return;
    }
    const presented = state.presented;
    state.presented = null;
    if (presented) {
      // Explicit resolution reasons AND any unknown reason: resolve-cancel
      // (fail-safe — never a hung callback). resolveOnce re-attempts the next
      // presentation once dequeued; void reads the enumerated set so the
      // fail-safe default is visible at the pin site.
      void RESOLUTION_REASONS;
      resolveOnce(presented, null);
    } else {
      // Already resolved via an answer path (its trailing 'activated' close
      // lands here) — this close is the queue event that presents the next.
      presentNext(record);
    }
  }

  /** Re-present trigger: a tab was activated on this window. @param {any} record @param {number} _wcId */
  function notifyTabActivated(record, _wcId) {
    presentNext(record);
  }

  /** Re-present trigger: the window regained OS focus (the blur-close's only counterpart). @param {any} record */
  function notifyWindowFocused(record) {
    presentNext(record);
  }

  /** Re-present trigger: HTML fullscreen exited on this window. @param {any} record */
  function notifyFullscreenExited(record) {
    presentNext(record);
  }

  /**
   * Sheet submit (via the zeroized menu-overlay:auth-submit handler). Record-
   * shaped like notifySheetClosed — the store holds no tokens; the IPC handler
   * already ran the freshness gate. Ledger FIRST, then the close (8b): the
   * store is the single sheet-closing site for answers, and the trailing
   * 'activated' close notification is an exactly-once no-op.
   * @param {any} record
   * @param {string} username
   * @param {any} password  Buffer (zeroized by the IPC handler) or string
   * @returns {{ answered: boolean, reason?: string }}
   */
  function answerFromSheet(record, username, password) {
    const state = states.get(record);
    const presented = state ? state.presented : null;
    // Kind guard (M14 F1 L3): a string credential must never feed a native
    // Certificate callback. The auth-submit IPC's token gate already excludes
    // this in practice (a live token can only belong to the open cert-picker
    // menu, not the auth card); pinned structurally anyway.
    if (!presented || presented.kind === 'client-cert') return { answered: false, reason: 'no-challenge' };
    resolveOnce(presented, { username, password });
    const cur = record.sheet?.getCurrentMenu?.();
    if (cur && cur.menuType === 'auth-basic') record.sheet.closeMenuOverlay('activated');
    return { answered: true };
  }

  /**
   * The agent seams' target resolver: the tab's presented-or-head pending
   * BASIC-AUTH challenge. kind:'client-cert' challenges are structurally
   * invisible to the agent path (M14 F1 L3 kind filter) — cert selection is
   * human-only this flight, and a string credential must never reach a native
   * Certificate callback. With a cert-picker presented and a basic-auth
   * challenge queued on the same tab, the agent answers the QUEUED challenge
   * without touching the visible sheet (the named edge case).
   * @param {WindowAuthState} state @param {number} wcId
   * @returns {Challenge | undefined}
   */
  function pendingBasicAuthFor(state, wcId) {
    const p = state.presented;
    if (p && p.wcId === wcId && p.kind !== 'client-cert') return p;
    return state.queue.find((c) => c.wcId === wcId && c.kind !== 'client-cert');
  }

  /**
   * Agent answer (the vault-context answerAuth delegate). Resolves the tab's
   * presented-or-head pending BASIC-AUTH challenge with the credential
   * (client-cert challenges are invisible here — pendingBasicAuthFor); closes
   * a visible auth sheet for that challenge with the RESOLUTION-family
   * 'activated' reason so the queue never re-presents an answered challenge.
   * @param {number} wcId
   * @param {{ username: any, password: any }} credential
   * @returns {{ answered: boolean, reason?: string }}
   */
  function answerWithCredential(wcId, credential) {
    for (const [record, state] of states) {
      const target = pendingBasicAuthFor(state, wcId);
      if (!target) continue;
      const wasPresented = state.presented === target;
      resolveOnce(target, credential);
      if (wasPresented) {
        const cur = record.sheet?.getCurrentMenu?.();
        if (cur && cur.menuType === 'auth-basic') record.sheet.closeMenuOverlay('activated');
      }
      return { answered: true };
    }
    return { answered: false, reason: 'no-challenge' };
  }

  /**
   * Cert-picker selection (M14 F1 L3). Called from register-overlay-ipc's
   * channel-4 'activated' handler BEFORE its trailing closeMenuOverlay — that
   * close maps 'activated' to resolution-cancel, so without ledger-FIRST
   * ordering every selection would resolve as a cancel. Bounds-checked: an
   * out-of-range/tampered index resolves CANCEL (never a throw, never a hung
   * callback). The trailing close's notifySheetClosed is then the exactly-once
   * no-op + the next-presentation queue event.
   * @param {any} record
   * @param {number} index
   * @returns {{ answered: boolean, reason?: string }}
   */
  function selectCertFromSheet(record, index) {
    const state = states.get(record);
    const presented = state ? state.presented : null;
    if (!presented || presented.kind !== 'client-cert') return { answered: false, reason: 'no-challenge' };
    const list = presented.list || [];
    const cert = Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
    resolveOnce(presented, cert ? { cert } : null);
    return { answered: true };
  }

  /**
   * Read seam for vault-context.answerAuth: the tab's presented-or-head
   * pending BASIC-AUTH challenge (client-cert challenges are invisible here —
   * pendingBasicAuthFor's kind filter), NON-SECRET fields only (no callback
   * exposure). The origin match derives from `url` — never authInfo.scheme
   * (the AUTH scheme).
   * @param {number} wcId
   * @returns {{ wcId: number, host: string, port: number | null, realm: string, url: string } | null}
   */
  function getPendingChallenge(wcId) {
    for (const [, state] of states) {
      const target = pendingBasicAuthFor(state, wcId);
      if (!target) continue;
      return {
        wcId: target.wcId,
        host: target.host,
        port: target.port ?? null,
        realm: target.realm || '',
        url: target.url
      };
    }
    return null;
  }

  return {
    handleLogin,
    handleSelectClientCertificate,
    cancelForTab,
    cancelForWindow,
    notifySheetClosed,
    notifyTabActivated,
    notifyWindowFocused,
    notifyFullscreenExited,
    answerFromSheet,
    answerWithCredential,
    selectCertFromSheet,
    getPendingChallenge
  };
}

module.exports = { createAuthChallenges };
