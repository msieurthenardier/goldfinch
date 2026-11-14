'use strict';

const { resolvePersistJar } = require('./persist-jar-gate');
const { isAdmissibleTabPartition } = require('./tab-create-validate');
const { sanitizeFpCounts } = require('../shared/privacy-fp');
const { committedOriginOf } = require('./vault/committed-origin');
const { destinationDisplay } = require('../shared/vault-destination');
const { validateMediaList } = require('./media-list');
// Generate-in-picker gesture payload validation (Mission 21, Flight 4, Leg 3 —
// generate-in-picker, DD5/AC8). Real ES module, loaded via Node's synchronous
// require(esm) — the settings-store.js / search-engines.js precedent.
const { sanitizeGenerateConstraints, resolvePolicy } = require('../shared/password-policy');

const PAGE_CONTEXT_ACTIONS = new Set(['cut', 'copy', 'paste', 'undo', 'redo']);
const EMPTY_COOKIES = Object.freeze({ firstParty: null, first: 0, third: 0, total: 0, list: [] });
// The refusal value for `privacy-cookies` (frozen: the gate hands the same object to every refusal).
const EMPTY_COOKIES_REFUSAL = Object.freeze({ ...EMPTY_COOKIES, list: Object.freeze([]) });

/**
 * Validate the page-influenced `generate` sub-payload a `guest-vault-gesture`
 * IPC MAY carry (flight DD5/AC8) — the guest preload's own `generateGestureInfo`
 * output, re-validated here rather than trusted: `passwordRole` must be the
 * LITERAL string `'new'`, and `constraints` must sanitize cleanly
 * (`sanitizeGenerateConstraints`). Returns `{ canGenerate, constraints }`
 * (availability decided by the SAME `resolvePolicy` the eventual generate
 * request re-runs, so the two can never disagree) or `null` when anything is
 * malformed or the role is not `'new'` — the caller then forwards today's bare
 * `{ wcId }` shape.
 * @param {any} payload
 * @returns {{ canGenerate: boolean, constraints: any } | null}
 */
function validateGenerateGesture(payload) {
  const g = payload && typeof payload === 'object' ? payload.generate : null;
  if (!g || typeof g !== 'object' || g.passwordRole !== 'new') return null;
  const constraints = sanitizeGenerateConstraints(g.constraints);
  if (!constraints) return null;
  return { canGenerate: resolvePolicy(constraints).ok, constraints };
}

function registerBrowserIpc({
  ipcMain,
  gate,
  webContents,
  chromeForTab,
  getTabContents,
  applyZoom,
  isInternalContents,
  toggleDevTools,
  registerInternalHandler,
  jars,
  registry,
  createWindow,
  broadcastJarsChanged,
  isSafeTabUrl,
  getChromeContents,
  session,
  registrableDomain,
  hostnameOf,
  shields,
  getVaultHuman,
  mediaProxyTokens,
  isVaultUnlocked,
  vaultImportBegin,
  clearPendingVaultImport,
  // M18 F3 Leg 3 (DD2 ruling 3(c)/3(e), DD7): the mapping-step seams — the page's
  // window-scoped labels fetch, the commit, and the sever-offer dismiss. All optional
  // (offline register-browser-ipc tests omit them).
  vaultImportFetchLabels,
  vaultImportCommit,
  vaultImportSeverDismiss,
  // M19 F1 Leg 2 (DD5/DD13): the browser-CSV-import flow's four channels. All optional
  // (offline register-browser-ipc tests omit them, mirroring the restore group above).
  browserImportBegin,
  browserImportSummary,
  browserImportCancel,
  browserImportCommit,
  popupVaultIconMenu,
  // Mission 23 Flight 1 (leg `vault-fill-trust`): the per-tab witness of real pointer input
  // (`vault/gesture-witness.js`). Optional only for offline harnesses that never raise a picker; a
  // registrar built without it refuses every gesture (fail-closed).
  gestureWitness,
  popupRegistry,
  random = Math.random,
  logger = console,
  // Opt-in capture-lifecycle trace (`GOLDFINCH_VAULT_TRACE=1`), OFF by default and
  // therefore silent in every normal run. It exists because the capture → hold →
  // unlock → finalize sequence spans three processes, so a failure anywhere in it
  // presented to the operator as "no prompt appeared" with nothing to go on.
  // What it prints is bounded BY CONSTRUCTION to non-secrets: the opaque main-minted
  // captureId, the tab's wcId, the disposition mode, and the finalize outcome — never
  // a password, a username, or an origin. Injected so a test can capture the calls.
  vaultTrace = process.env.GOLDFINCH_VAULT_TRACE === '1'
    ? (/** @type {string} */ step, /** @type {any} */ fields) =>
        logger.info('[vault-capture]', step, JSON.stringify(fields))
    : () => {}
}) {
  // Mission 23 Flight 1 (`ipc-gate-complete`): every channel below registers through the gate,
  // which names WHO may call it and refuses everyone else before the handler runs; a handler that
  // needs the window record calls `gate.requireChrome(event)` (single source of the comparison).
  // The page-influenced channels are the TAB-GUEST class (the sender's own main frame, a web tab
  // — see ipc-gate.js); a tab id the chrome names is the OWNING-CHROME class.
  /** The webContentsId a chrome payload names (defensive: any payload shape; none → `undefined`). */
  const webContentsIdOfPayload = (/** @type {any} */ payload) =>
    payload && typeof payload === 'object' ? payload.webContentsId : undefined;
  const wcIdOfPayload = (/** @type {any} */ payload) =>
    payload && typeof payload === 'object' ? payload.wcId : undefined;

  const farbleSeeds = new WeakMap();
  function seedForSession(sess) {
    let seed = farbleSeeds.get(sess);
    if (seed == null) {
      seed = Math.floor(random() * 0xffffffff) >>> 0;
      farbleSeeds.set(sess, seed);
    }
    return seed;
  }
  function rerollSeed(sess) {
    farbleSeeds.set(sess, Math.floor(random() * 0xffffffff) >>> 0);
  }

  // SYNCHRONOUS (the guest preload blocks its page's load on this reply), so the gate's sync form
  // always answers. Popups are admitted (a script-opened popup farbles too). A refused sender —
  // not a tab or popup main frame — gets farbling ON with a per-call random seed: never an
  // un-farbled surface, never the session's seed. That is NOT a protection against the page
  // itself: an admitted main-frame page can read its own session's seed.
  gate.tabGuest.sync(
    'shields-farble',
    { popups: true },
    (event, url) => {
      const site = registrableDomain(hostnameOf(url || ''));
      return {
        farble: shields.active('farble', site),
        seed: seedForSession(event.sender.session)
      };
    },
    { produce: () => ({ farble: true, seed: Math.floor(random() * 0xffffffff) >>> 0 }) }
  );

  gate.chrome.on('window-minimize', (event) => {
    gate.requireChrome(event)?.win.minimize();
  });
  gate.chrome.on('window-toggle-maximize', (event) => {
    const rec = gate.requireChrome(event);
    if (!rec) return;
    if (rec.win.isMaximized()) rec.win.unmaximize();
    else rec.win.maximize();
  });
  gate.chrome.on('window-close', (event) => {
    gate.requireChrome(event)?.win.close();
  });
  gate.chrome.handle(
    'window-is-maximized',
    (event) => {
      const rec = gate.requireChrome(event);
      return !!(rec && rec.win.isMaximized());
    },
    { value: false }
  );
  gate.chrome.handle(
    'window-create',
    () => {
      return createWindow().win.id;
    },
    { value: null }
  );
  gate.chrome.handle(
    'new-container-create',
    async (_event, payload) => {
      const name = payload && payload.name;
      if (!name || typeof name !== 'string') return null;
      const container = jars.add(name);
      broadcastJarsChanged();
      return container;
    },
    { value: null }
  );

  // Vault lock-icon eligibility (M12 F2 Leg 1, DD9): the guest preload queries this
  // synchronously at init (shields-farble idiom) to decide whether to inject the
  // decorative lock icon. Eligible ONLY when the tab's session resolves to a
  // PERSISTENT jar (resolvePersistJar) — burner/non-persistent tabs are not
  // eligible, so no icon, no gesture wiring. The wcId is the trusted sender id; we
  // resolve the tab entry from the registry, never from renderer-supplied data.
  // SYNCHRONOUS — the gate's sync form always answers; popups are admitted (they are simply never
  // eligible: not in tabViews). A refused sender is answered "not eligible, locked".
  gate.tabGuest.sync(
    'vault-eligible',
    { popups: true },
    (event) => {
      const entry = registry.getWindowForGuest(event.sender.id)?.tabViews.get(event.sender.id);
      const eligible = Boolean(entry && resolvePersistJar(entry, jars.list()));
      // Return { eligible, unlocked } so the preload can also seed the lock-icon glyph's
      // state (open/green when unlocked, closed/amber when locked). The boolean is non-secret
      // (the chrome indicator already shows it). `isVaultUnlocked` is injection-gated — absent
      // (offline tests) → unlocked:false, the safe/locked default.
      const unlocked = typeof isVaultUnlocked === 'function' ? isVaultUnlocked() === true : false;
      return { eligible, unlocked };
    },
    { value: { eligible: false, unlocked: false } }
  );

  // Vault gesture (M12 F2 Leg 1, DD1/DD3; extended M21 F4 Leg 3 — generate-in-picker, DD5/AC8;
  // rebuilt by Mission 23 Flight 1, leg `vault-fill-trust`, revised DD4). The page-side message is only
  // a HINT: a page holding the preload's IPC object can send it with no click at all, from any tab. It
  // is honoured only when (the tab-guest class has already required an ACTIVE web tab) MAIN itself
  // witnessed a real left-button click on this tab, inside the box the message reports (scaled by the
  // tab's live zoom), recently, at most once per click and per interval - `vault/gesture-verifier.js`
  // has the ordered rules, `gesture-witness.js` consumes the click on acceptance only. The box is
  // page-supplied: the stated residual (docs/vault.md) is that a page that sends the message itself can
  // claim a box around a real click the operator made on that page; the picker's own controls (next
  // leg) are the defence against a misdirected click.
  //
  // On acceptance main mints a per-open PICKER CONTEXT (picker-context.js: the tab, its COMMITTED
  // origin, the certificate-override flag) and pushes `vault-gesture` to the owning chrome carrying its
  // id, the destination display string and the certificate flag next to today's fields. wcId comes only
  // from event.sender.id; `generate` is re-validated (`validateGenerateGesture`) and forwarded as
  // `{ canGenerate, constraints }` for a valid `passwordRole: 'new'` gesture, else absent.
  /** The committed origin of a tab's guest, or `null` (derived read - see vault/committed-origin.js). */
  const committedOriginFor = (/** @type {any} */ wc) =>
    wc && !wc.isDestroyed?.() && typeof wc.getURL === 'function' ? committedOriginOf(wc.getURL()) : null;
  const zoomFor = (/** @type {any} */ wc) => (wc && typeof wc.getZoomFactor === 'function' ? wc.getZoomFactor() : 1);

  /**
   * Mint the context and send the enriched push. The caller has ALREADY admitted the gesture (or, for
   * "Fill login...", is re-checking the live tab). `generate` is the validated sub-payload or null.
   * @param {number} wcId
   * @param {string} origin
   * @param {{ canGenerate: boolean, constraints: any } | null} generate
   */
  function raisePicker(wcId, origin, generate) {
    if (!getVaultHuman) return;
    const entry = registry.getWindowForGuest(wcId)?.tabViews?.get(wcId);
    const ctx = getVaultHuman().mintContext({ wcId, origin, certOverride: !!entry && entry.security === 'overridden' });
    const push = { wcId, contextId: ctx.id, destination: destinationDisplay(origin), certificate: ctx.certOverride };
    chromeForTab(wcId)?.send('vault-gesture', generate ? { ...push, generate } : push);
  }

  /** @param {'gesture' | 'icon-menu'} kind @param {any} event @param {unknown} payload */
  function admitIconMessage(kind, event, payload) {
    if (!gestureWitness) return null;
    const wcId = event.sender.id;
    const wc = getTabContents ? getTabContents(wcId) : event.sender;
    const origin = committedOriginFor(wc);
    const decision = gestureWitness.admit({
      kind,
      wcId,
      message: payload,
      zoom: zoomFor(wc),
      origin
    });
    return decision.ok ? { origin: /** @type {string} */ (origin) } : null;
  }

  gate.tabGuest.on('guest-vault-gesture', { activeOnly: true }, (event, payload) => {
    const admitted = admitIconMessage('gesture', event, payload);
    if (!admitted) return;
    raisePicker(event.sender.id, admitted.origin, validateGenerateGesture(payload));
  });

  // Guest tab-boundary signal (M17 Flight 1 Leg 1, DD2): the guest preload's
  // capturing Tab/Shift+Tab handler sends this when tabBoundary(document, dir)
  // says the press would leave the page's tabbable sequence. Same shape as
  // guest-vault-gesture above: wcId comes ONLY from event.sender.id (never a
  // renderer-supplied one — a hostile page cannot forge a boundary event for a
  // wcId that isn't its own), and `direction` is validated against the two
  // literals before forwarding — an unrecognized value is silently dropped,
  // never forwarded as-is.
  gate.tabGuest.on('guest-tab-boundary', { internalTabs: true, activeOnly: true }, (event, payload) => {
    const direction = payload && payload.direction;
    if (direction !== 'forward' && direction !== 'backward') return;
    const wcId = event.sender.id;
    chromeForTab(wcId)?.send('tab-boundary', { direction });
  });

  // Vault fill-icon CONTEXT menu (M12 F5 HAT batch 1, I8; admission Mission 23 Flight 1, leg
  // `vault-fill-trust`): a right-click on the injected lock icon arrives here carrying only the icon's box.
  // Honoured only on the same terms as the gesture above, with the RIGHT-button PRESS as the witnessed
  // input (press only - the platform decides whether `contextmenu` fires on press or release). The wcId
  // is event.sender.id; the owning window comes from the registry; the injected delegate builds a NATIVE
  // Electron Menu (never DOM in the guest) and pops it over that window. The committed origin captured
  // at admission goes to the delegate with a `raise` closure: the "Fill login..." item's click re-checks
  // that the tab is still alive, still its window's ACTIVE tab and still at that origin, and only then
  // mints a context and sends the enriched push. The delegate is injected so this module stays
  // Electron-free (offline tests may omit it -> the icon menu no-ops).
  gate.tabGuest.on('guest-vault-icon-menu', { activeOnly: true }, (event, payload) => {
    const admitted = admitIconMessage('icon-menu', event, payload);
    if (!admitted) return;
    const wcId = event.sender.id;
    const win = registry.getWindowForGuest(wcId)?.win;
    const { origin } = admitted;
    popupVaultIconMenu?.({
      wcId,
      win,
      origin,
      raise: () => {
        const wc = getTabContents ? getTabContents(wcId) : event.sender;
        const owner = registry.getWindowForGuest(wcId);
        if (!wc || wc.isDestroyed?.() || !owner || owner.activeTabWcId !== wcId) return;
        if (committedOriginFor(wc) !== origin) return;
        raisePicker(wcId, origin, null);
      }
    });
  });

  // Vault capture — GESTURE-TIME HOLD (Mission 21 F1 Leg 5, broadened-capture,
  // superseding the M12 F2 Leg 4 submit-only version). A qualifying gesture's
  // credential arrives here as { username, usernameDetected, password }
  // (password a Uint8Array) — READ at gesture time in the guest, already
  // provenance-filtered by the isolated-world observer. The trusted wcId is
  // event.sender.id; the ORIGIN is derived in main from the sender URL (never
  // the guest-supplied value — none is sent) and FROZEN at hold time
  // (`holdGestureLogin`), never re-derived at settle. This handler does NOT
  // dispose or offer anything — `getVaultHuman().holdGestureLogin` only gates
  // (set up / persistent jar / origin) and HOLDS; the offer is raised only at
  // SETTLE (guest-wiring.js's did-navigate hook, or the guest-vault-gesture-
  // settle handler below for the SPA/detachment case) — DD3f/DD4. Gated on the
  // getVaultHuman injection (offline tests omit it).
  gate.tabGuest.on('guest-vault-capture', {}, (event, payload) => {
    if (!getVaultHuman) return;
    const wcId = event.sender.id;
    // `currentPassword` (Mission 21, Flight 4, Leg 2 — password-field-roles,
    // DD3a/DD4) is OPTIONAL — present only when the gesture's login scope
    // classified with a provenanced `current` field (a rotation form).
    const { username, usernameDetected, password, currentPassword } = /** @type {any} */ (payload || {});
    const held = getVaultHuman().holdGestureLogin({
      wcId,
      username,
      usernameDetected: usernameDetected === true,
      passwordBytes: password,
      currentPasswordBytes: currentPassword
    });
    vaultTrace('gesture-hold', { wcId, held: !!held, kind: 'login' });
  });

  // Vault CARD capture (issue #152) — the card twin of the gesture-time hold
  // above. { number, cvv } (both Uint8Array) + the non-secret cardholder /
  // expiry strings. Same trust shape: wcId from event.sender.id, origin
  // derived + frozen main-side, held (never disposed) here.
  gate.tabGuest.on('guest-vault-capture-card', {}, (event, payload) => {
    if (!getVaultHuman) return;
    const wcId = event.sender.id;
    const { number, cvv, cardholder, expiry } = /** @type {any} */ (payload || {});
    const held = getVaultHuman().holdGestureCard({
      wcId,
      numberBytes: number,
      cvvBytes: cvv,
      cardholder,
      expiry
    });
    vaultTrace('gesture-hold', { wcId, held: !!held, kind: 'card' });
  });

  // Vault IDENTITY capture (M21 F3 Leg 4, AC10) — the identity twin of the
  // gesture-time hold above. LD2: { identitySecrets, fullName } — identitySecrets
  // a Uint8Array (the UTF-8 JSON of the ten secret identity fields), fullName a
  // plain string (the one non-secret field). Same trust shape: wcId from
  // event.sender.id, origin derived + frozen main-side (never guest-supplied),
  // held (never disposed/offered) here — the offer is raised only at SETTLE.
  gate.tabGuest.on('guest-vault-capture-identity', {}, (event, payload) => {
    if (!getVaultHuman) return;
    const wcId = event.sender.id;
    const { identitySecrets, fullName } = /** @type {any} */ (payload || {});
    const held = getVaultHuman().holdGestureIdentity({
      wcId,
      identitySecretsBytes: identitySecrets,
      fullName
    });
    vaultTrace('gesture-hold', { wcId, held: !!held, kind: 'identity' });
  });

  // Settle — the DETACHMENT signal (DD4's SPA case). A bare, payload-free
  // trigger — main derives the trusted wcId from event.sender.id, the
  // guest-vault-gesture idiom — reported by the guest-side gesture-detachment
  // watch (webview-preload.js) when a held gesture read's field set is fully
  // removed from the DOM without any navigation ever committing. The
  // navigation-commit settle signal lives in guest-wiring.js's did-navigate
  // handler instead — this is the SECOND of DD4's two settle paths, never the
  // only one. M21 F3 L2 (LD1): the IPC stays payload-free and TAB-scoped even
  // though the watch that fires it is now per-family (webview-preload.js) —
  // main keeps releasing EVERY pending record for the tab, never just the
  // family whose fields detached (a `kind` on the payload would let a
  // guest-supplied value steer which held record releases, against this
  // channel's own documented no-payload trust shape).
  gate.tabGuest.on('guest-vault-gesture-settle', {}, (event) => {
    if (!getVaultHuman) return;
    const wcId = event.sender.id;
    const offers = getVaultHuman().captureRelease(wcId);
    vaultTrace('settle', {
      wcId,
      via: 'detachment',
      count: offers.length,
      modes: offers.map((o) => o.model && o.model.mode)
    });
    // Sortie 06 Leg 1 (DD5/AC12): offers carry the tab's `wcId` and go out only while that tab
    // is its window's ACTIVE tab; otherwise the held capture is dropped main-side.
    const offerOwner = registry.getWindowForGuest(wcId);
    for (const offer of offers) {
      if (!offerOwner || offerOwner.activeTabWcId !== wcId) {
        getVaultHuman().captureDismiss(offer.captureId);
        continue;
      }
      chromeForTab(wcId)?.send('vault-capture-offer', { captureId: offer.captureId, model: offer.model, wcId });
    }
  });

  // Vault capture DISMISS (M12 F2 Leg 4, DD7): the chrome invokes this when the
  // corner save prompt closes WITHOUT a save (and when an offer cannot be presented) (Cancel / Escape / outside-click / a
  // lifecycle close), so main drops+zeroizes the held record immediately rather than
  // waiting for the 2-min safety timeout. The captureId is an opaque main-minted
  // handle, not a secret. Mission 23 Flight 1: chrome class (the argument is an opaque capture id, never a tab id,
  // and a late dismiss of an expired capture must still be accepted from the chrome).
  gate.chrome.handle(
    'vault-capture-dismiss',
    (_event, captureId) => {
      vaultTrace('dismiss', { captureId });
      if (getVaultHuman && typeof captureId === 'string') getVaultHuman().captureDismiss(captureId);
    },
    'throw'
  );

  // Vault capture FINALIZE (unlock-to-save continuation): after a login-form submit into a
  // LOCKED vault, capture() held the credential (mode 'locked') and the chrome raised an
  // unlock prompt. On a successful unlock the chrome invokes this to compute the deferred
  // save/update disposition and present it in the corner save prompt. Returns { captureId, model }, or
  // a discriminated { reason } the chrome turns into an operator-visible message (expired /
  // locked / tab-changed / unchanged) — never a bare null, because a silent nothing after the
  // operator typed their master password is indistinguishable from a defect. Same chrome-trust
  // bare handle as dismiss; the captureId is an opaque main-minted handle, no password.
  //
  // Sortie 06 Leg 2 (flight DD7, AC7): this bare handle is the ONE place a consented locked save is
  // written (inside `captureFinalize`, behind `rec.consent`), so it gained guards: (1) SENDER - the
  // calling chrome must be the window that OWNS the capture's tab (else `refused`, record intact,
  // no write); (2) ACTIVE TAB - the capture's tab must be that window's active tab (else the record
  // is dropped and `tab-changed` returned, no write). Unknown / non-string ids stay `expired` /
  // null as before.
  gate.chrome.handle(
    'vault-capture-finalize',
    (event, captureId) => {
      if (!getVaultHuman || typeof captureId !== 'string') return null;
      const vh = getVaultHuman();
      const wcId = vh.captureTabOf(captureId);
      if (wcId == null) {
        vaultTrace('finalize', { captureId, outcome: 'expired' });
        return { reason: 'expired' };
      }
      const owner = registry.getWindowForGuest(wcId);
      const caller = gate.requireChrome(event);
      if (!owner || !caller || owner !== caller) {
        vaultTrace('finalize', { captureId, outcome: 'refused' });
        return { reason: 'refused' };
      }
      if (owner.activeTabWcId !== wcId) {
        vh.captureDismiss(captureId);
        vaultTrace('finalize', { captureId, outcome: 'tab-changed' });
        return { reason: 'tab-changed' };
      }
      const res = vh.captureFinalize(captureId);
      vaultTrace('finalize', {
        captureId,
        outcome: res && res.saved ? 'saved' : res && res.model ? `offer:${res.model.mode}` : res && res.reason
      });
      return res;
    },
    { value: { reason: 'refused' } }
  );

  // Vault cross-renderer triggers (M12 F3 Leg 4, first-run-setup, DD5). The internal
  // goldfinch://vault page cannot call chrome-trust menuOverlay.* directly, so its
  // not-set-up CTA (requestSetup) and locked affordance (requestUnlock) invoke these
  // origin-gated channels. Main resolves the OWNING window's chrome via
  // chromeForTab(event.sender.id) — the internal tab is in tabViews, so getWindowForGuest
  // resolves it — and forwards a BARE trigger (no secret), the onVaultGesture →
  // vault-gesture idiom. registerInternalHandler rejects any non-internal sender before
  // the body runs. The distinct channels drive the DISTINCT chrome handlers: setup opens
  // vault-set; unlock opens vault-unlock WITHOUT F2's pendingVaultFlow fill-picker
  // continuation. Placed here (not registerVaultIpc) because this file has chromeForTab.
  registerInternalHandler(ipcMain, 'internal-vault-request-setup', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-setup');
    return { ok: true };
  });
  registerInternalHandler(ipcMain, 'internal-vault-request-unlock', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-unlock');
    return { ok: true };
  });

  // Vault access-key MINT trigger (M12 F3 Leg 5, flight DD5 / mission durable-grant
  // step-up). Mirrors internal-vault-request-setup — a BARE cross-renderer trigger with
  // NO secret — but EXTENDED with the NON-SECRET target vault id so the chrome opens the
  // vault-stepup sheet scoped to that vault. The step-up master password is entered on the
  // chrome-owned sheet and the minted secret is shown on the chrome-owned vault-accesskey
  // sheet — never the page DOM (DD5). Main resolves the OWNING window's chrome via
  // chromeForTab(event.sender.id) (the internal tab is in tabViews). registerInternalHandler
  // rejects any non-internal sender before the body runs; the target is re-validated
  // main-side by the store's _resolveTarget when mintAccessKey runs (a compromised sheet
  // cannot mint against a burner/unknown target).
  registerInternalHandler(ipcMain, 'internal-vault-request-mint', (event, target) => {
    chromeForTab(event.sender.id)?.send('vault-request-mint', { target });
    return { ok: true };
  });

  // Vault RESTORE (M12 F4 Leg 1 export-import, DD1/DD2; SPLIT for the M12 F5 HAT page modal, I14;
  // RESHAPED M18 F3 Leg 3 / DD2 — one unified workflow, destination bound at COMMIT time). The
  // restore is a multi-step flow driven by the page, so it splits into page-invoked channels —
  // NONE of which ever carries a secret:
  //
  //  1. internal-vault-pick-import-file (pickImportFile) — awaits the injected `vaultImportBegin`
  //     delegate: it runs the open dialog, reads + parses the bundle (ciphertext) and HOLDS
  //     { bundle, handle } main-side (NO destination — ruling 1), returning
  //     { ok, path, importHandle } | { canceled } | { error }. It does NOT forward — the sheet
  //     opens only when the operator submits the pick modal.
  //  2. internal-vault-begin-import-unlock (beginImportUnlock) — a BARE trigger (no payload; the
  //     destination/mode decision moved entirely to the commit-time mapping step) forwarding
  //     vault-request-import to the owning chrome (chromeForTab(event.sender.id) — the internal
  //     tab is in tabViews), which opens the chrome-owned vault-import-unlock sheet. Unconditional
  //     (mirrors internal-vault-request-setup), NOT gated on an injection.
  //  3. internal-vault-clear-pending-import (clearPendingImport) — drops the held record at ANY
  //     step (pick-modal Cancel, or post-secret the mapping-modal Cancel — the DD5 matrix's
  //     explicit-cancel row) when the operator dismisses. Always safe to call.
  //  4. internal-vault-import-labels (vaultImportFetchLabels) — the page's window-scoped fetch,
  //     invoked after the labels-ready notification: a NON-SECRET { handle, labels } projection,
  //     or null when this window holds nothing past the secret step (the page treats null as a
  //     strict no-op — DD2's "Labels-ready fan-out" edge case).
  //  5. internal-vault-import-commit (vaultImportCommit) — `{ handle, mapping }` → runs the
  //     restore and returns the per-vault outcomes + generation, or a non-secret refusal.
  //  6. internal-vault-sever-dismiss (vaultImportSeverDismiss) — DD7's offer-card dismiss.
  //
  // registerInternalHandler rejects any non-internal sender before each body runs.
  // PR#112 finding 5: the held import record is keyed by the OWNING CHROME id, so window A's
  // pick can never be read/mutated/cleared/consumed by window B. Every step resolves the same
  // window key via chromeForTab(event.sender.id) — the internal page tab's owning chrome — which
  // is also the identity the secret sheet submits under. The opaque `handle` (returned by the
  // pick) is echoed by the page on the mutating steps as a per-transaction guard within the window.
  if (vaultImportBegin) {
    registerInternalHandler(ipcMain, 'internal-vault-pick-import-file', async (event) => {
      return await vaultImportBegin(chromeForTab(event.sender.id)?.id);
    });
  }
  registerInternalHandler(ipcMain, 'internal-vault-begin-import-unlock', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-import');
    return { ok: true };
  });
  if (clearPendingVaultImport) {
    registerInternalHandler(ipcMain, 'internal-vault-clear-pending-import', (event, handle) => {
      clearPendingVaultImport(chromeForTab(event.sender.id)?.id, handle);
      return { ok: true };
    });
  }
  if (vaultImportFetchLabels) {
    registerInternalHandler(ipcMain, 'internal-vault-import-labels', (event) => {
      return vaultImportFetchLabels(chromeForTab(event.sender.id)?.id);
    });
  }
  if (vaultImportCommit) {
    registerInternalHandler(ipcMain, 'internal-vault-import-commit', async (event, payload) => {
      const { handle, mapping } = payload || {};
      if (typeof handle !== 'string' || !mapping || typeof mapping !== 'object') {
        return { ok: false, reason: 'state' };
      }
      return await vaultImportCommit(chromeForTab(event.sender.id)?.id, handle, mapping);
    });
  }
  if (vaultImportSeverDismiss) {
    registerInternalHandler(ipcMain, 'internal-vault-sever-dismiss', () => {
      vaultImportSeverDismiss();
      return { ok: true };
    });
  }

  // Browser-CSV password import (M19 F1 Leg 2 / DD5, DD13). A separate flow from the
  // restore group above: no secret sheet (a plaintext CSV has no secret to unwrap), no
  // labels-ready push (the page drives every step itself). Each channel resolves the
  // OWNING window via chromeForTab(event.sender.id) — the internal vault tab is in
  // tabViews — and is gated on its own injected delegate.
  if (browserImportBegin) {
    registerInternalHandler(ipcMain, 'internal-vault-browser-import-pick', async (event) => {
      return await browserImportBegin(chromeForTab(event.sender.id)?.id);
    });
  }
  if (browserImportSummary) {
    registerInternalHandler(ipcMain, 'internal-vault-browser-import-summary', (event) => {
      return browserImportSummary(chromeForTab(event.sender.id)?.id);
    });
  }
  if (browserImportCancel) {
    registerInternalHandler(ipcMain, 'internal-vault-browser-import-cancel', (event, handle) => {
      browserImportCancel(chromeForTab(event.sender.id)?.id, handle);
      return { ok: true };
    });
  }
  if (browserImportCommit) {
    registerInternalHandler(ipcMain, 'internal-vault-browser-import-commit', async (event, payload) => {
      const { handle, target, mode } = payload || {};
      if (typeof handle !== 'string' || typeof target !== 'string' || typeof mode !== 'string') {
        return { ok: false, reason: 'state' };
      }
      return await browserImportCommit(chromeForTab(event.sender.id)?.id, { handle, target, mode });
    });
  }

  // Vault ROTATION / RECOVER cross-renderer triggers (M12 F4 Leg 2 key-rotation, DD3/DD2). All
  // three mirror internal-vault-request-setup — a BARE trigger with NO secret — routing the vault
  // page's rotation-section actions to the owning chrome (chromeForTab(event.sender.id) — the
  // internal tab is in tabViews). The secret entry lives on the chrome-owned sheet, never this
  // channel or the page DOM. rotate-recovery reuses the vault-stepup sheet (master-pw step-up);
  // change-master opens the vault-change-master sheet (old + new); recover opens the vault-recover
  // sheet (recovery key + new — reachable FROM LOCKED). registerInternalHandler rejects any
  // non-internal sender before the body runs.
  registerInternalHandler(ipcMain, 'internal-vault-request-rotate-recovery', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-rotate-recovery');
    return { ok: true };
  });
  // M12 F4 Leg 3 (admin-key-provision): the admin-key PROVISION/ROTATE affordance — a BARE trigger
  // (no secret) reusing the vault-stepup sheet (master-pw step-up, mode 'rotate-admin'). The new
  // admin private key is shown once on the chrome-owned vault-adminkey-show sheet, never this channel.
  registerInternalHandler(ipcMain, 'internal-vault-request-rotate-admin', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-rotate-admin');
    return { ok: true };
  });
  registerInternalHandler(ipcMain, 'internal-vault-request-change-master', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-change-master');
    return { ok: true };
  });
  registerInternalHandler(ipcMain, 'internal-vault-request-recover', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-recover');
    return { ok: true };
  });
  // M18 F2 L4 (compromise-mode rotation): the compromise-rotation trigger — a BARE
  // trigger (no secret) fired by the vault page's confirm modal Continue, routing to
  // the owning chrome, which opens the vault-compromise sheet (master branch; the
  // sheet's own switch affordance reopens the recovery branch). Reachable from BOTH
  // lock states (R4 — the sheet doubles as unlock on the locked path). Every secret
  // + the one-time recovery display live on chrome-owned sheets, never this channel.
  registerInternalHandler(ipcMain, 'internal-vault-request-compromise', (event) => {
    chromeForTab(event.sender.id)?.send('vault-request-compromise');
    return { ok: true };
  });

  // Mission 23 Flight 1 (leg `jar-isolation`): the list is page-controlled, so it is rebuilt in main
  // (`validateMediaList`) and pushed with the tab's proxy token. A token belongs to a document: the
  // sender frame must be the tab's CURRENT main frame (both frame tokens read as plain values here),
  // otherwise the list is dropped and nothing is pushed - a late list from a replaced document is never
  // handed the new document's token. The token is delivered to the chrome only and is never logged.
  gate.tabGuest.on('guest-media-list', {}, (event, mediaList) => {
    const wcId = event.sender.id;
    let senderFrameToken;
    let mainFrameToken;
    try {
      senderFrameToken = event.senderFrame?.frameToken;
      mainFrameToken = event.sender.mainFrame?.frameToken;
    } catch {
      return;
    }
    const mediaToken = mediaProxyTokens.issue(wcId, senderFrameToken, mainFrameToken);
    if (!mediaToken) return;
    chromeForTab(wcId)?.send('tab-media-list', { wcId, mediaList: validateMediaList(mediaList), mediaToken });
  });
  gate.tabGuest.on('guest-privacy-fp', {}, (event, rawFpCounts) => {
    const wcId = event.sender.id;
    // NF8: the counts are page-influenced — forward only a validated object (fixed key set,
    // non-negative integers clamped to a ceiling); anything else is dropped whole.
    const fpCounts = sanitizeFpCounts(rawFpCounts);
    if (!fpCounts) return;
    chromeForTab(wcId)?.send('tab-privacy-fp', { wcId, fpCounts });
  });
  // window.close() from a web guest (issue #119 — the webview-preload shim).
  // Electron's native path would close the owning BaseWindow; this one closes
  // the TAB, via the chrome's normal close path (strip removal, closed-tab
  // capture, never-zero-tabs fallback). Class-3 owner-routed push: resolved at
  // event time; a non-tab sender resolves no chrome and no-ops. historyLength
  // is guest-supplied — sanitized to a number, and only ever used to decide the
  // SENDER'S own close, so a forged value cannot affect any other tab.
  gate.tabGuest.on('guest-window-close', { popups: true }, (event, payload) => {
    const wcId = event.sender.id;
    // M14 F2 L1 (DD1d): popup-registry lookup FIRST — a popup's window.close()
    // destroys its own BrowserWindow (the chrome path below structurally
    // misses popups: chromeForTab resolves via tabViews, which popups never
    // join). No permission gate needed: every registered popup is
    // script-opened by construction, exactly the class Chromium lets close
    // itself. destroy() (not close()) — the popup teardown hooks ride
    // `closed`/`destroyed`, and popups have no close-time capture (DD1e).
    const popupEntry = popupRegistry?.getByWcId(wcId);
    if (popupEntry) {
      if (popupEntry.win && !popupEntry.win.isDestroyed()) popupEntry.win.destroy();
      return;
    }
    const raw = /** @type {any} */ (payload || {}).historyLength;
    const historyLength = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
    chromeForTab(wcId)?.send('tab-self-close', { wcId, historyLength });
  });
  gate.owningChrome.on('rescan-media', wcIdOfPayload, (event, payload) => {
    const { wcId } = /** @type {any} */ (payload || {});
    if (wcId == null) return;
    const wc = getTabContents(wcId);
    if (!wc || wc.isDestroyed()) return;
    wc.send('rescan-media');
  });

  function externalContents(payload) {
    const id = payload && payload.webContentsId;
    const wc = typeof id === 'number' ? webContents.fromId(id) : null;
    return wc && !wc.isDestroyed() && !isInternalContents(wc) ? wc : null;
  }

  // Mission 23 Flight 1 (`ipc-gate-complete`, NF7): every handler below is OWNING-CHROME — the
  // tab id it names must belong to the sender's window — AHEAD of its existing
  // externalContents/target guard (which is not replaced, and still refuses internal tabs).
  gate.owningChrome.on('zoom-apply', webContentsIdOfPayload, (event, payload) => {
    const wc = externalContents(payload);
    if (wc) applyZoom(wc, payload.action);
  });
  gate.owningChrome.handle(
    'get-zoom',
    webContentsIdOfPayload,
    (_event, payload) => externalContents(payload)?.getZoomFactor() ?? null,
    { value: null }
  );
  gate.owningChrome.on('print', webContentsIdOfPayload, (event, payload) => {
    const wc = externalContents(payload);
    if (!wc) return;
    wc.print({}, (ok, reason) => {
      if (!ok) logger.warn('print failed:', reason);
    });
  });
  gate.owningChrome.handle(
    'toggle-devtools',
    webContentsIdOfPayload,
    (event, payload) => {
      const wc = externalContents(payload);
      return wc ? toggleDevTools(wc) : false;
    },
    { value: false }
  );
  gate.owningChrome.handle(
    'is-devtools-open',
    webContentsIdOfPayload,
    (event, payload) => {
      const wc = externalContents(payload);
      return wc ? wc.isDevToolsOpened() : false;
    },
    { value: false }
  );
  gate.owningChrome.handle(
    'page-context-correct',
    webContentsIdOfPayload,
    (event, payload) => {
      const wc = externalContents(payload);
      if (!wc) return;
      const word = payload && payload.word;
      if (typeof word === 'string' && word) {
        wc.focus();
        wc.replaceMisspelling(word);
      }
    },
    { value: undefined }
  );
  gate.owningChrome.handle(
    'page-context-action',
    webContentsIdOfPayload,
    (event, payload) => {
      const wc = externalContents(payload);
      if (!wc) return;
      const action = payload && payload.action;
      if (!PAGE_CONTEXT_ACTIONS.has(action)) return;
      wc[action]();
    },
    { value: undefined }
  );

  registerInternalHandler(ipcMain, 'internal-open-tab-in-jar', (_event, payload) => {
    if (payload === null || typeof payload !== 'object') {
      return { ok: false, error: 'open-tab-in-jar — malformed-payload' };
    }
    const entry = jars.list().find((jar) => jar.id === payload.jarId);
    if (!entry) return { ok: false, error: 'open-tab-in-jar — unknown-jar' };
    if (typeof payload.url !== 'string' || !isSafeTabUrl(payload.url)) {
      return { ok: false, error: 'open-tab-in-jar — bad-args' };
    }
    getChromeContents()?.send('open-tab', { url: payload.url, openerPartition: entry.partition });
    return { ok: true };
  });

  gate.chrome.handle(
    'identity-new',
    async (event, payload) => {
      const partition = payload && payload.partition;
      // Mission 23 Flight 1 (22c): the SAME partition predicate `tab-create` uses — a registered
      // jar's partition or a burner by exact shape — so this can neither create nor wipe an
      // arbitrary partition.
      if (!isAdmissibleTabPartition(partition, jars.list())) return { ok: false };
      const sess = session.fromPartition(partition);
      if (sess.__goldfinchInternal) return { ok: false };
      try {
        await sess.clearStorageData();
        await sess.clearCache();
        rerollSeed(sess);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    },
    { value: { ok: false } }
  );

  gate.owningChrome.handle(
    'privacy-cookies',
    webContentsIdOfPayload,
    async (event, payload) => {
      const { webContentsId, url } = /** @type {any} */ (payload || {});
      const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
      if (!wc || wc.session.__goldfinchInternal) return { ...EMPTY_COOKIES, list: [] };
      const firstParty = registrableDomain(hostnameOf(url || wc.getURL() || ''));
      const all = await wc.session.cookies.get({});
      let first = 0;
      let third = 0;
      const list = all
        .map((cookie) => {
          const domain = registrableDomain(cookie.domain.replace(/^\./, ''));
          const isThird = !!firstParty && domain !== firstParty;
          if (isThird) third++;
          else first++;
          return {
            name: cookie.name,
            domain: cookie.domain,
            third: isThird,
            secure: cookie.secure,
            session: !cookie.expirationDate
          };
        })
        .sort((a, b) => (a.third === b.third ? 0 : a.third ? 1 : -1));
      return { firstParty, first, third, total: all.length, list: list.slice(0, 300) };
    },
    { value: EMPTY_COOKIES_REFUSAL }
  );

  gate.owningChrome.handle(
    'privacy-clear-cookies',
    webContentsIdOfPayload,
    async (event, payload) => {
      const { webContentsId, scope, url } = /** @type {any} */ (payload || {});
      const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
      if (!wc || wc.session.__goldfinchInternal) return { removed: 0 };
      const firstParty = registrableDomain(hostnameOf(url || wc.getURL() || ''));
      const all = await wc.session.cookies.get({});
      let removed = 0;
      for (const cookie of all) {
        const isThird = !!firstParty && registrableDomain(cookie.domain.replace(/^\./, '')) !== firstParty;
        if (scope !== 'all' && !(scope === 'third' && isThird)) continue;
        const host = cookie.domain.replace(/^\./, '');
        try {
          await wc.session.cookies.remove(
            `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
            cookie.name
          );
          removed++;
        } catch {
          // Individual cookie removal failures do not abort the bounded sweep.
        }
      }
      return { removed };
    },
    { value: { removed: 0 } }
  );

  gate.owningChrome.handle(
    'privacy-clear-storage',
    webContentsIdOfPayload,
    async (event, payload) => {
      const { url, webContentsId } = /** @type {any} */ (payload || {});
      const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
      if (!wc || wc.session.__goldfinchInternal) return { ok: false, error: 'no-tab' };
      try {
        const origin = new URL(url).origin;
        await wc.session.clearStorageData({ origin });
        return { ok: true, origin };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    },
    { value: { ok: false, error: 'no-tab' } }
  );

  return { rerollSeed };
}

module.exports = { registerBrowserIpc, validateGenerateGesture };
