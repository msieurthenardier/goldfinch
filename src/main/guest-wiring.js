// @ts-check
'use strict';

// M14 F1 L4 (DD5, security-assessed): Chromium's built-in PDF viewer loads as a
// chrome-extension: SUBFRAME inside the guest (premise-checked live: with
// `plugins: true`, navigating a guest to a PDF fires `will-frame-navigate` with
// `isMainFrame === false` and URL `chrome-extension://<this id>/<stream-uuid>`
// — refused by strict guardNav, which blanks the viewer). The id is Chromium's
// fixed built-in PDF viewer extension id; the carve-out below admits exactly
// this host, subframe-only, on `will-frame-navigate` only — `will-navigate` and
// `will-redirect` stay fully strict (top-frame page-JS and redirect attempts
// keep being refused by guardNav itself; the omnibox/MCP path is independently
// refused by tab-navigate's trust-branched gate).
const PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

// M14 F2 L1: the sole sanctioned `closed` registration wrapper (the DD8
// destroyed-window tripwire bans raw registrations tree-wide) — popup teardown
// routes through it like every other window. window-factory is Electron-free;
// no cycle (it never requires this module).
const { onWindowClosed } = require('./window-factory');
const { isBurnerPartition } = require('../shared/burner');
// Mission 20 Flight 1 (DD2/DD4): the shared classification predicates and the
// entry-URL substitution helper — both Electron-free, both required at the
// established main-side CJS-of-ESM pattern (`settings-store.js:24` et al.).
const { shouldRecordLoadFailure, isChromeErrorUrl, classifyCertError } = require('../shared/load-failure');
const { effectiveUrl } = require('./tab-entry-url');
// Mission 20 Flight 2 Leg 2 (DD6/DD7): the security-state enum + pure
// derivation, and the observer's durable-copy read seam.
const { deriveSecurityState, SECURITY_STATES } = require('../shared/site-security');

/**
 * M14 F2 L1 — the DD3 popup predicate (pure, exported for the unit matrix),
 * carrying the leg-design disposition refinement (FD-logged): qualifying =
 * `disposition === 'new-window'` (Chromium's own popup classification — without
 * it, middle-clicks (`background-tab`) and plain clicks on named-target links
 * (`foreground-tab`) would become focused floating popups) AND (non-empty
 * `features` string OR a named non-`_blank` target) AND a safe URL AND a
 * non-internal opener. Named consequence (flight-logged, premise-confirmed
 * live): `window.open(url, 'name')` with NO features is classified
 * `foreground-tab` by Chromium, so it keeps deny-and-convert — the disposition
 * conjunction intentionally narrows DD3's original "features OR named" reading.
 * @param {{ url: string, frameName?: string, features?: string, disposition?: string }} details
 * @param {{ isSafeTabUrl: (url: string) => boolean, isInternalOpener: boolean }} ctx
 * @returns {boolean}
 */
function qualifiesAsPopupRequest({ url, frameName, features, disposition }, { isSafeTabUrl, isInternalOpener }) {
  return (
    disposition === 'new-window' &&
    ((typeof features === 'string' && features.length > 0) ||
      (typeof frameName === 'string' && frameName !== '' && frameName !== '_blank')) &&
    isSafeTabUrl(url) &&
    !isInternalOpener
  );
}

/**
 * Build the event wiring shared by web and trusted-internal guest views. The
 * module owns no Electron state; owner lookups and every side effect are live
 * dependency reads so moved tabs automatically rebind to their new window.
 * @param {any} deps
 */
function createGuestWiring(deps) {
  const {
    registry,
    chromeForTab,
    htmlFullscreen,
    authChallenges,
    crossViewNavAction,
    keydownToAction,
    isChromeActionForwardable,
    isRepeatSafeAction,
    isInternalPageUrl,
    isSafeTabUrl,
    toggleDevTools,
    applyZoom,
    isInternalContents,
    getHistoryRecorder,
    broadcastMoveTargetsChanged,
    faviconFetcher,
    popupRegistry,
    webPreloadPath,
    // Mission 20 Flight 2 Leg 2 (DD6): the session-level certificate-
    // verification observer's read seam (`did-navigate`'s durable-copy stamp).
    certObserver,
    // Squawk 0073: arms the continuous session-snapshot debounce (built + owned in
    // main.js) on a URL change — the snapshot's `url` field must track live
    // navigation, not just tab creation/close/activation. Optional-chained so an
    // offline harness that omits it stays unaffected.
    scheduleSnapshot,
    // Mission 20 Flight 1 (DD1/AC7): the ONE two-axis visibility helper, defined
    // top-level in `register-tab-ipc.js` and threaded here via `main.js` deps
    // (rather than a direct require) — the unit suite injects a RECORDING fake so
    // AC3's call-order assertion is a real order test, not a side-effect inference.
    applyGuestVisibility,
    // M14 F2 L2 (DD1f seam, real wiring): the SAME delegation main.js hands the
    // popup registry — cancelForTab(popupWcId, 'tab-close'). Called from the
    // popup teardown below so a SELF-closed/destroyed popup (guest-window-close,
    // OS close) resolve-cancels its queued/presented challenges exactly like the
    // owner-window close path (closeAllForRecord invokes the seam per entry
    // before destroying). Optional: absent → no-op (leg-1-era tests unchanged).
    cancelChallengesForPopup = () => {},
    // Mission 20 Flight 3 Leg 2 (DD1/DD2/DD7): OPTIONAL crash-record sink,
    // the SAME "leave the composition root passing nothing" shape as
    // `cancelChallengesForPopup`'s own default no-op below, except this one
    // stays genuinely optional (`onCrash?.(...)` at every call site) — leg 3
    // wires `crash-log.js` in here via `main.js` deps threading; this leg
    // only calls the shape.
    onCrash,
    // Mission 20 Flight 3 Leg 3 (DD5): boot-gated per-tab push routing — sends
    // immediately when the owning chrome is booted, else queues on the
    // record's pendingChromeSends (flushed, deduped, by window-boot-config's
    // recoverTabs branch). Lifted to a module-level export of
    // register-tab-ipc.js and constructed once in main.js BEFORE this module
    // and registerTabIpc both receive it — one implementation.
    sendOrQueue,
    logger
  } = deps;

  /**
   * M14 F2 L1 (review Issue 1): POPUP-REGISTRY-FIRST owner resolution, shared
   * by the window-open handler and did-create-window below. A popup opener
   * resolves its registry entry's openerRecord; a tab opener falls back to the
   * window registry. Liveness-checked: a dead/absent record resolves null
   * (window.open during opener teardown must refuse the allow path).
   * @param {any} contents
   * @returns {{ owner: any | null, popupEntry: any | null }}
   */
  function resolveOpenerOwner(contents) {
    const popupEntry = popupRegistry.getByWcId(contents.id);
    const resolved = popupEntry ? popupEntry.openerRecord : registry.getWindowForGuest(contents.id);
    const owner = resolved && resolved.win && !resolved.win.isDestroyed() ? resolved : null;
    return { owner, popupEntry };
  }

  function handleCrossView(event, input, contents) {
    if (input.type !== 'keyDown') return false;
    const action = crossViewNavAction({
      key: input.key,
      control: input.control,
      meta: input.meta,
      shift: input.shift,
      alt: input.alt
    });
    if (!action) return false;
    event.preventDefault();
    if (input.isAutoRepeat) return true;
    const chrome = chromeForTab(contents.id);
    chrome?.focus();
    // M17 F1 L2 (DD6, design review): forward the COMPUTED action — this used
    // to hardcode 'focus-address', which silently made Shift+F6's
    // 'focus-chrome-end' behave like plain F6 (guest-wiring.test.js pins the
    // send payload per action).
    chrome?.send('chrome-shortcut-action', { action });
    return true;
  }

  function handleChromeShortcut(event, input, guestKind, contents) {
    if (input.type !== 'keyDown') return false;
    const action = keydownToAction({
      key: input.key,
      ctrl: input.control,
      meta: input.meta,
      shift: input.shift,
      alt: input.alt,
      lightboxOpen: false
    });
    if (!isChromeActionForwardable(action, guestKind)) return false;
    event.preventDefault();
    if (isRepeatSafeAction(action) || !input.isAutoRepeat) {
      chromeForTab(contents.id)?.send('chrome-shortcut-action', { action });
    }
    return true;
  }

  function wireGuestContents(contents) {
    // Mission 13 Flight 3 / Leg 3 (DD3, AC3): set the latch synchronously, before
    // any navigation can occur, so the app-lifecycle web-contents-created catch-all
    // (which cannot yet distinguish this guest from a chrome/overlay view at ITS
    // attach time — that fires during `new WebContentsView()`, before this function
    // runs) reads the latch INSIDE its own handler and early-returns for guests.
    // A future `await` inserted between `new WebContentsView()` and this call would
    // reopen the race the latch closes — keep this assignment first and synchronous.
    contents.__goldfinchNavGuarded = true;

    // M14 F2 L1 (flight DD1/DD3, human-ruled Option B): the window-open ruling.
    // Qualifying popup requests (DD3 predicate above) return allow+override —
    // the return deliberately carries NO adopt hook (DD2 pin, source-scanned:
    // the spike proved returning any other contents from that hook permanently
    // wedges the opener renderer, silently). Everything else keeps
    // deny-and-convert with OWNER-AWARE forwarding: a popup-originated
    // `target=_blank` (e.g. a "forgot password" link inside an OAuth popup)
    // opens as a tab in the RESOLVED owning window with the popup's captured
    // partition — never vanishes. Internal openers, unsafe URLs, and
    // tab-intent dispositions always deny(-convert).
    contents.setWindowOpenHandler((details) => {
      const { url } = details;
      const { owner, popupEntry } = resolveOpenerOwner(contents);
      const qualifies =
        owner != null &&
        qualifiesAsPopupRequest(details, {
          isSafeTabUrl,
          isInternalOpener: !!contents.session?.__goldfinchInternal
        });
      if (qualifies) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              // DD1d posture — premise-#2-verified live in this exact
              // allow+override combination (flight log): preload honored,
              // contextIsolation:false (farbling main-world requirement),
              // sandbox:true, nodeIntegration:false, plugins:true (guest
              // parity ruling — without it the guardFrameNav PDF carve-out is
              // dead code in popups). NO partition key: the popup's session is
              // automatically the opener's jar (spike-verified; partition
              // overrides are silently ignored).
              preload: webPreloadPath,
              contextIsolation: false,
              sandbox: true,
              nodeIntegration: false,
              plugins: true
            }
          }
        };
      }
      if (popupEntry) {
        // Popup opener: forward to the owning window's chrome (chromeForTab
        // misses by construction — popups are not in tabViews) with the
        // partition captured at register time. Dead owner → plain deny.
        const chrome = owner && !owner.chromeView.webContents.isDestroyed() ? owner.chromeView.webContents : null;
        chrome?.send('open-tab', { url, openerPartition: popupEntry.partition });
        return { action: 'deny' };
      }
      const rec = registry.getWindowForGuest(contents.id);
      const openerPartition = rec ? rec.tabViews.get(contents.id)?.partition : undefined;
      chromeForTab(contents.id)?.send('open-tab', { url, openerPartition });
      return { action: 'deny' };
    });

    // Mission 13 Flight 3 / Leg 3 (DD3, AC1): session-aware predicate shared by
    // top-frame navigations, subframe navigations, and redirects. All three events
    // read `event.url` — `will-frame-navigate` passes a SINGLE merged Event (no
    // positional url arg); `will-navigate`/`will-redirect` also expose `event.url`
    // on the same event object. Reading a positional second argument here would
    // read `undefined` for will-frame-navigate and preventDefault on every subframe
    // navigation, breaking ordinary browsing.
    const guardNav = (event) => {
      if (contents.session?.__goldfinchInternal) {
        if (!isInternalPageUrl(event.url)) event.preventDefault();
      } else if (!isSafeTabUrl(event.url)) {
        event.preventDefault();
      }
    };
    // M14 F1 L4 (DD5): frame-scoped PDF-viewer carve-out. This wrapper REPLACES
    // the bare guardNav registration on `will-frame-navigate` ONLY — keeping
    // both listeners would leave strict guardNav still preventDefault'ing the
    // viewer subframe, making the allow path dead code. Allow iff the event is
    // a SUBFRAME navigation (strict `=== false` — an event lacking the field
    // fails closed into guardNav), on a non-internal guest, whose URL parses
    // (URL-parse, never startsWith; parse failure falls through to guardNav)
    // with scheme `chrome-extension:` and host exactly the pinned viewer id.
    // Everything else delegates to guardNav unchanged.
    const guardFrameNav = (event) => {
      if (event.isMainFrame === false && !contents.session?.__goldfinchInternal) {
        let parsed;
        try {
          parsed = new URL(event.url);
        } catch {
          parsed = null;
        }
        if (parsed && parsed.protocol === 'chrome-extension:' && parsed.host === PDF_VIEWER_EXTENSION_ID) {
          return; // the built-in PDF viewer's own subframe — allowed (DD5)
        }
      }
      guardNav(event);
    };
    contents.on('will-navigate', guardNav);
    contents.on('will-frame-navigate', guardFrameNav);
    contents.on('will-redirect', guardNav);

    if (contents.session?.__goldfinchInternal) {
      contents.on('before-input-event', (event, input) => {
        if (handleCrossView(event, input, contents)) return;
        handleChromeShortcut(event, input, 'internal', contents);
      });
      return;
    }

    // M14 F1 L1 (DD1): HTML5 element fullscreen — WEB guests only (the internal
    // branch above already returned; a goldfinch:// page has no business seizing
    // the window). Blink fires these around requestFullscreen()/exitFullscreen();
    // the injected module owns the record mode, geometry, and overlay
    // coordination — nothing here reads records directly.
    contents.on('enter-html-full-screen', () => htmlFullscreen.enter(contents.id));
    contents.on('leave-html-full-screen', () => htmlFullscreen.exit(contents.id));

    // M14 F2 L1 (DD1a/DD1c/DD1f): popup adoption. The OPENER contents emits
    // did-create-window with the new BrowserWindow. Premise #1 (flight-logged,
    // measured live): this fires BEFORE the popup's first navigation event, so
    // wiring the latch + guards here is race-free — the DD1c pending-popup
    // fallback stays unused and app-lifecycle is untouched. Web guests only
    // (an internal opener can never reach the allow path).
    contents.on('did-create-window', (win) => {
      const popupWc = win.webContents;
      const { owner: openerRecord, popupEntry: parentEntry } = resolveOpenerOwner(contents);
      if (!openerRecord) {
        // Opener died between the allow return and window creation (teardown
        // race): a popup with no owning record sits outside every DD1f/census
        // rule — destroy it before it ever navigates.
        if (!win.isDestroyed()) win.destroy();
        return;
      }
      // Partition captured EAGERLY (leg 2's census/attribution needs it after
      // the opener tab dies). Chained popups parent FLAT to the same
      // openerRecord and inherit its captured partition (named simplification).
      const partition = parentEntry ? parentEntry.partition : openerRecord.tabViews.get(contents.id)?.partition;
      const popupWcId = popupWc.id;

      // Squawk 0036 (#104 carve-out, burner-hardening invariant): a popup
      // opened from a burner tab inherits the opener's jar/session (DD1d —
      // NO partition key in overrideBrowserWindowOptions, so this webContents
      // never goes through tab-create's own policy call). Applied here off the
      // SAME captured `partition` the popup's own history/census attribution
      // already relies on, so it stays correct even after the opener tab dies.
      if (isBurnerPartition(partition)) {
        popupWc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      }

      // Full guest discipline first (audited reuse): latch, guardNav trio +
      // guardFrameNav wrapper (the GUEST nav-guard shape — never the wider
      // non-guest ALLOWED_NONGUEST_SCHEMES), input surfaces, and the popup's
      // own window-open handler (chained popups). Chrome-routed sends inside
      // resolve a null chrome for popups and no-op — the named-accepted input
      // gaps (chrome shortcuts swallowed, no context menu; Electron-default
      // parity, documented for HAT). htmlFullscreen.enter early-returns on
      // its registry miss, so popup HTML fullscreen stays native.
      wireGuestContents(popupWc);
      popupRegistry.register(popupWcId, {
        openerWcId: contents.id,
        openerRecord,
        partition,
        win
      });

      // Slim popup event variant (deliberately NOT wireTabViewEvents — there
      // is no chrome strip to feed): history records under the opener's jar
      // (DD1c — it is real browsing in that jar), titles feed the recorder's
      // late-title backfill, and teardown deregisters.
      //
      // M14 F2 L2 (DD2 navigation-away, popup parity): a main-frame, non-same-
      // document navigation resolve-cancels the popup's pending challenges —
      // the same filter and reason as wireTabViewEvents' tab wiring, so DD2's
      // max-staleness contract (one navigation) holds for popups too.
      popupWc.on('did-start-navigation', (e) => {
        if (!popupWc.isDestroyed() && e.isMainFrame && !e.isSameDocument) {
          authChallenges.cancelForTab(popupWcId, 'navigated');
        }
      });
      popupWc.on('did-navigate', () => {
        if (!popupWc.isDestroyed()) {
          getHistoryRecorder()?.handleNavigation({ wcId: popupWcId, partition, url: popupWc.getURL() });
        }
      });
      popupWc.on('did-navigate-in-page', () => {
        if (!popupWc.isDestroyed()) {
          getHistoryRecorder()?.handleNavigation({ wcId: popupWcId, partition, url: popupWc.getURL() });
        }
      });
      popupWc.on('page-title-updated', (_event, title) => {
        getHistoryRecorder()?.handleTitleUpdated(popupWcId, title);
      });

      // Mission 20 Flight 3 Leg 2 (DD2): a popup has no strip, no panel, and
      // no chrome to push to — a dead popup renderer records (leg 3 wires
      // crash-log.js) and CLOSES the popup window, so the opener sees an
      // ordinary closed window instead of a gray one that never answers. No
      // reload affordance (accepted: an OAuth flow re-opens from the page).
      popupWc.on('render-process-gone', (_event, details) => {
        const { reason, exitCode } = details || {};
        if (reason === 'clean-exit') return;
        onCrash?.({
          kind: 'popup',
          reason,
          exitCode,
          url: popupWc.getURL(),
          partition,
          windowId: win.id,
          recovery: 'closed'
        });
        if (!win.isDestroyed()) win.close();
      });

      // Teardown rides the events destroy() actually EMITS — `closed` on the
      // window (via the sanctioned onWindowClosed wrapper: captured-primitive
      // discipline, never a raw registration) and `destroyed` on the contents
      // (destroy() skips `close`). Idempotent pair; inputs captured at wiring
      // time (house destroyed-window rule — never read win.* in
      // closed-or-later handlers). forgetTab is required here: the
      // window-factory close loop only covers tabViews, which popups never
      // join (DD1e).
      const teardown = () => {
        // DD1f cancel seam (M14 F2 L2): resolve-cancel this popup's queued/
        // presented challenges BEFORE deregistering — a self-closed popup must
        // never strand a native callback, and the owning record's visible auth
        // sheet closes with a resolution-family reason. Idempotent alongside
        // closeAllForRecord's per-entry seam call (the exactly-once ledger makes
        // the second cancel a no-op) and safe on the already-canceled path.
        cancelChallengesForPopup(popupWcId);
        popupRegistry.remove(popupWcId);
        getHistoryRecorder()?.forgetTab(popupWcId);
      };
      onWindowClosed(win, teardown);
      popupWc.on('destroyed', teardown);
    });

    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (handleCrossView(event, input, contents)) return;
      if (handleChromeShortcut(event, input, 'web', contents)) return;

      if (input.key === 'F12') {
        if (!input.isAutoRepeat) toggleDevTools(contents);
        event.preventDefault();
        return;
      }
      // M14 F1 L1 (DD1): defensive Esc. Blink normally exits element fullscreen
      // on Esc itself (firing leave-html-full-screen), but if that native path
      // ever fails to run this ask keeps Esc working: page-side exit only
      // (document.exitFullscreen → leave event → exit()), never a direct
      // main-side restore. Deliberately NO preventDefault — the page may have
      // its own Esc handling, and exit() is idempotent when both paths fire.
      // MUST sit before the modifier early-return below: Esc carries no
      // modifier and would never reach a later branch.
      if (input.key === 'Escape') {
        if (!input.isAutoRepeat && htmlFullscreen.isFullscreen(contents.id)) {
          contents.executeJavaScript('document.exitFullscreen()').catch(() => {});
        }
        return;
      }
      if (!(input.control || input.meta)) return;

      let zoomAction = null;
      if (input.key === '=' || input.key === '+') zoomAction = 'in';
      else if (input.key === '-') zoomAction = 'out';
      else if (input.key === '0') zoomAction = 'reset';

      if (input.key === 'p' || input.key === 'P') {
        contents.print({}, (ok, reason) => {
          if (!ok) logger.warn('print failed:', reason);
        });
        event.preventDefault();
        return;
      }
      if (input.key === 'f' || input.key === 'F') {
        event.preventDefault();
        chromeForTab(contents.id)?.send('open-find');
        return;
      }
      if ((input.key === 'j' || input.key === 'J') && !input.isAutoRepeat) {
        event.preventDefault();
        chromeForTab(contents.id)?.send('open-downloads');
        return;
      }
      if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
        if (!input.isAutoRepeat) toggleDevTools(contents);
        event.preventDefault();
        return;
      }
      if (!zoomAction) return;
      applyZoom(contents, zoomAction);
      event.preventDefault();
    });

    const sendDevtoolsState = (open) => {
      chromeForTab(contents.id)?.send('devtools-state-changed', { wcId: contents.id, open });
    };
    contents.on('devtools-opened', () => sendDevtoolsState(true));
    contents.on('devtools-closed', () => sendDevtoolsState(false));
    contents.on('context-menu', (event, params) => {
      event.preventDefault();
      if (isInternalContents(contents)) return;
      chromeForTab(contents.id)?.send('page-context-menu', { wcId: contents.id, params });
    });
  }

  function wireTabViewEvents(view, wcId, partition) {
    const wc = view.webContents;
    const sendToChrome = (channel, payload) => sendOrQueue(wcId, channel, payload);
    const guard =
      (fn) =>
      (...args) => {
        if (!wc.isDestroyed()) fn(...args);
      };
    // Mission 20 Flight 1: both new handlers below (and the did-navigate push)
    // need the owning record's own tabViews entry for this wcId — the SAME entry
    // register-tab-ipc.js created (`entry.view === view`). Optional-chained: a
    // record with no `tabViews` (offline test fakes that never touch this leg's
    // fields) or a torn-down/absent record both resolve `undefined`, never throw.
    const resolveEntry = () => registry.getWindowForGuest(wcId)?.tabViews?.get(wcId);

    // M14 F1 L2 (DD2): navigation-away is a pending-auth-challenge RESOLUTION
    // trigger — main-frame, non-same-document navigations only (a hash change
    // or an in-page pushState must not cancel a live prompt; subframe
    // navigation is unrelated to the top-level challenge's fate). Max
    // challenge staleness is therefore one navigation.
    wc.on(
      'did-start-navigation',
      guard((e) => {
        if (e.isMainFrame && !e.isSameDocument) authChallenges.cancelForTab(wcId, 'navigated');
        // Mission 20 Flight 1 (DD2/AC4): a real, page-initiated main-frame navigation
        // stamps the intended address and — if a failure was recorded — clears it.
        // The error document's OWN `chrome-error:` commit must NEVER erase the
        // failure it is reporting (whether it even raises this event at all is
        // spike check (d); this guard is safe either way).
        if (e.isMainFrame && !e.isSameDocument && !isChromeErrorUrl(e.url)) {
          const entry = resolveEntry();
          if (entry) {
            entry.lastRequestedUrl = e.url;
            // Mission 20 Flight 2 Leg 2 (DD1): a real, page-initiated
            // main-frame navigation invalidates any pending/prior cert
            // decision stamp — the error document's own `chrome-error:`
            // commit is excluded above, same guard as the loadFailure clear.
            entry.certFailure = null;
            entry.certOverride = null;
            if (entry.loadFailure) {
              entry.loadFailure = null;
              applyGuestVisibility(entry);
              sendToChrome('tab-load-failure', { wcId, failure: null });
            }
            // Mission 20 Flight 3 Leg 2 (DD1/DD2/DD3): a real navigation
            // (the crashed guest's own respawn-and-reload, or an ordinary
            // navigation that lands before a pending kill actually crashed
            // the renderer) clears the crash/hang state and any lingering
            // kill-and-reload flag — the flight-log Decision's "a navigation
            // that lands before the crash event means the kill did not
            // happen; the flag must not linger."
            if (entry.crash) {
              entry.crash = null;
              applyGuestVisibility(entry);
              sendToChrome('tab-crash', { wcId, crash: null });
            }
            if (entry.hung) {
              entry.hung = false;
              sendToChrome('tab-hung', { wcId, hung: false });
            }
            entry.killRequested = false;
          }
        }
      })
    );
    // Mission 20 Flight 1 (DD2/AC3): the failure signal itself. Recorded only for
    // top-frame failures that are not ERR_ABORTED (user-cancelled navigations and
    // downloads fire -3 and are not failures) — `shouldRecordLoadFailure` is the
    // single source for that guard. A torn-down entry (edge case: the failure
    // arrives mid-teardown, after the tab's own tabViews entry is already gone)
    // drops silently — never throws.
    wc.on(
      'did-fail-load',
      guard((_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!shouldRecordLoadFailure({ errorCode, isMainFrame })) return;
        const owner = registry.getWindowForGuest(wcId);
        const entry = owner?.tabViews?.get(wcId);
        if (!owner || !entry) return;
        entry.loadFailure = { code: errorCode, name: errorDescription, url: validatedURL };
        // Edge case: an empty validatedURL (some engine paths) keeps the prior
        // lastRequestedUrl — `failure.url` above already carries whatever the
        // engine handed back, empty or not.
        if (validatedURL) entry.lastRequestedUrl = validatedURL;
        // Mission 20 Flight 2 Leg 2 (DD1/DD4): fold a pending certFailure stamp
        // into this failure's `.cert` field. `cert-trust.js` holds only ONE
        // certFailure slot at a time (overwritten on every refusal) — so for
        // the two-rapid-cert-errors edge case (a redirect chain, A→B, both
        // bad) there is never more than one candidate to fold: whichever
        // stamp is CURRENT at this instant is, by construction, "the latest"
        // the leg's edge-case ruling calls for. Cleared unconditionally right
        // after, so a certFailure can never leak into an unrelated LATER
        // failure.
        if (entry.certFailure) {
          if (typeof errorDescription === 'string' && errorDescription.startsWith('ERR_CERT_')) {
            const cf = entry.certFailure;
            entry.loadFailure.cert = {
              host: cf.host,
              port: cf.port,
              error: cf.error,
              // Mission 20 Flight 2 Leg 3 (DD2/DD3): the proceed handler keys
              // the override from THIS field, never from a payload — carry it
              // through the fold (it was in cert-trust.js's stamp but not
              // here, so the interstitial's recorded failure had no
              // fingerprint to key an override with).
              fingerprint: cf.fingerprint,
              overridable: classifyCertError(cf.error).overridable,
              summary: cf.summary
            };
          }
          entry.certFailure = null;
        }
        // Pinned order (DD1, extended by Mission 20 Flight 2 Leg 2): record →
        // fold cert (above) → hide (if active) → close find (if active) →
        // chromeNavPending clear (below) → tell the chrome. The sheet is left
        // alone — an open menu is the operator's, not the page's.
        if (owner.activeTabWcId === wcId) {
          applyGuestVisibility(entry);
          owner.findOverlay?.hide();
        }
        // Mission 20 Flight 2 Leg 1 (#216, DD12): the F1 did-fail-load/did-finish-load
        // `wc.isFocused()` reasserts that used to live here are REMOVED — the leg-1
        // diagnostic run on the live rig found the steal to be a few-ms-after-
        // `loadURL` `focus`/`blur` cycle on the GUEST's webContents that starts and
        // is largely resolved BEFORE this handler ever runs (well before
        // did-fail-load), so a one-shot reassert keyed to this instant raced the
        // steal and lost (confirmed by the debrief: "did not change the observed
        // behavior"). The fix is now
        // upstream — a `chromeNavPending` flag armed at `tab-navigate` (when the
        // sender chrome held focus) and a reactive chrome-`blur` listener
        // (`window-factory.js`) that reasserts chrome focus the instant it fires,
        // however many times the guest re-steals it. `chromeNavPending` clears
        // right below.
        entry.chromeNavPending = false;
        sendToChrome('tab-load-failure', { wcId, failure: entry.loadFailure });
        // Mission 20 Flight 2 Leg 4 (design review, HIGH): a tab that loaded
        // securely and then fails kept its STALE security value — no push
        // fired on failure, so the chip could read "secure" for a page that
        // no longer resolves at all (DD7/DD16's invariant, "a failed or
        // cert-blocked tab has security: none", was never enforced end to
        // end). Fixed at the source: stamp `none` and push it right after
        // the failure push, unconditionally (a fresh commit recomputes it on
        // its own did-navigate — this never needs to be un-set elsewhere).
        entry.security = SECURITY_STATES.NONE;
        sendToChrome('tab-security', { wcId, security: SECURITY_STATES.NONE });
      })
    );
    // Mission 20 Flight 3 Leg 2 (DD1/DD2): a dead guest renderer. `clean-exit`
    // (a normal renderer shutdown, e.g. during window/tab teardown) is
    // ignored; a gone window or a gone tabViews entry (mid-teardown) is
    // ignored too — never read `win.*` here (the Wayland wedge), which is why
    // this resolves the OWNER record fresh rather than reading through `win`.
    wc.on(
      'render-process-gone',
      guard((_event, details) => {
        const { reason, exitCode } = details || {};
        if (reason === 'clean-exit') return;
        const owner = registry.getWindowForGuest(wcId);
        const entry = owner?.tabViews?.get(wcId);
        if (!owner || !entry) return;
        // Mission 20 Flight 3 Leg 2 (DD3, flight-log Decision): the
        // kill-and-reload bypass gates on `killRequested` ALONE, never on
        // `reason` — spike (f) measured `forcefullyCrashRenderer()` reporting
        // itself as `reason: 'crashed'` on this platform, not `'killed'`.
        if (entry.killRequested) {
          entry.killRequested = false;
          entry.hung = false;
          sendToChrome('tab-hung', { wcId, hung: false });
          onCrash?.({
            kind: 'guest',
            reason,
            exitCode,
            wcId,
            url: effectiveUrl(entry),
            partition,
            windowId: owner.win.id,
            recovery: 'reloaded'
          });
          wc.reload();
          return;
        }
        const wasHung = entry.hung;
        entry.crash = { reason, exitCode, url: effectiveUrl(entry) };
        entry.loadFailure = null;
        entry.hung = false;
        applyGuestVisibility(entry);
        if (owner.activeTabWcId === wcId) {
          owner.findOverlay?.hide();
        }
        entry.security = SECURITY_STATES.NONE;
        sendToChrome('tab-crash', { wcId, crash: entry.crash });
        if (wasHung) sendToChrome('tab-hung', { wcId, hung: false });
        sendToChrome('tab-security', { wcId, security: SECURITY_STATES.NONE });
        onCrash?.({
          kind: 'guest',
          reason,
          exitCode,
          wcId,
          url: entry.crash.url,
          partition,
          windowId: owner.win.id,
          recovery: 'panel'
        });
      })
    );
    // Mission 20 Flight 3 Leg 2 (DD3/DD4): Chromium's own input-driven hang
    // detection — no watchdog added. A crashed, kill-pending, or TRUSTED
    // (internal) entry never shows the hang bar — trusted pages are ours, and
    // a crash/kill already owns the tab's takeover state.
    wc.on(
      'unresponsive',
      guard(() => {
        const entry = resolveEntry();
        if (!entry || entry.trusted || entry.crash || entry.killRequested) return;
        entry.hung = true;
        sendToChrome('tab-hung', { wcId, hung: true });
      })
    );
    wc.on(
      'responsive',
      guard(() => {
        const entry = resolveEntry();
        if (!entry) return;
        entry.hung = false;
        sendToChrome('tab-hung', { wcId, hung: false });
      })
    );
    wc.on(
      'did-navigate',
      guard(() => {
        // Mission 20 Flight 1 (DD4): substitute the intended address for a live
        // chrome-error: URL — the census, the address bar, and history must never
        // see the error document's own URL.
        const entry = resolveEntry();
        // Mission 20 Flight 2 Leg 1 (#216, DD12): disarm the pending flag here too
        // — this fires for a genuinely successful commit AND for the internal
        // `chrome-error:` document's own eventual commit, so either way the
        // "chrome-initiated navigation in flight" window has closed.
        if (entry) entry.chromeNavPending = false;
        const url = entry ? effectiveUrl(entry) : wc.getURL();
        sendToChrome('tab-did-navigate', { wcId, url });
        // Mission 20 Flight 2 Leg 2 (DD6/DD7, FD amendment to DD7): certificate +
        // security state at each main-frame commit. Its OWN owner-routed push
        // (`tab-security`), sent right after `tab-did-navigate` — never riding
        // that channel itself, because the adopt re-push (register-tab-ipc.js)
        // must NOT replay `tab-did-navigate` (its chrome handler resets
        // media/privacy/suggestions).
        if (entry) {
          const rawUrl = wc.getURL();
          /** @type {string} */
          let security = SECURITY_STATES.NONE;
          let certificate = null;
          // Edge case: did-navigate never fires for a chrome-error: commit
          // (F1 spike (b)) — defensive only, since effectiveUrl already
          // guards the URL the chrome sees.
          if (!isChromeErrorUrl(rawUrl)) {
            let hostname;
            let port = /** @type {number | null} */ (null);
            try {
              const parsed = new URL(url);
              hostname = parsed.hostname;
              port = parsed.port
                ? Number(parsed.port)
                : parsed.protocol === 'https:'
                  ? 443
                  : parsed.protocol === 'http:'
                    ? 80
                    : null;
            } catch {
              hostname = null;
            }
            const verification = hostname ? certObserver.lookup(partition, hostname) : null;
            certificate = verification || null;
            const overridden =
              !!entry.certOverride && entry.certOverride.host === hostname && entry.certOverride.port === port;
            security = deriveSecurityState({ url, internal: !!entry.trusted, verification, overridden });
          }
          // HAT F5: `entry.certificate` stays the observer's raw lookup
          // result for this navigation regardless of `overridden` — it is
          // NOT the overridden-tab viewer source (that's `certOverride.summary`,
          // read via tab-certificate-get in register-tab-ipc.js). This field
          // remains the `secure` path's viewer source only; on an overridden
          // tab it can be stale/wrong-port (the observer keys by hostname
          // only, with no port) and must never be read for display.
          entry.certificate = certificate;
          entry.security = security;
          sendToChrome('tab-security', { wcId, security });
        }
        sendToChrome('tab-nav-state', {
          wcId,
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward()
        });
        getHistoryRecorder()?.handleNavigation({ wcId, partition, url });
        // Squawk 0073: the URL changed — debounced snapshot re-arm.
        scheduleSnapshot?.();
      })
    );
    wc.on(
      'did-navigate-in-page',
      guard(() => {
        sendToChrome('tab-did-navigate-in-page', { wcId, url: wc.getURL() });
        sendToChrome('tab-nav-state', {
          wcId,
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward()
        });
        getHistoryRecorder()?.handleNavigation({ wcId, partition, url: wc.getURL() });
        // Squawk 0073: the URL changed — debounced snapshot re-arm.
        scheduleSnapshot?.();
      })
    );
    wc.on(
      'page-title-updated',
      guard((_event, title) => {
        sendToChrome('tab-title', { wcId, title });
        getHistoryRecorder()?.handleTitleUpdated(wcId, title);
        if (registry.getWindowForGuest(wcId)?.activeTabWcId === wcId) broadcastMoveTargetsChanged();
      })
    );
    // Mission 13 Flight 1 / Leg 1 (DD1): favicons are fetched MAIN-SIDE in the
    // guest's own jar session (never the jar registry — burner partitions exist
    // only renderer-side) and delivered as a size-capped data: URL. Nothing
    // reaches the chrome on failure — no raw remote favicon URL is forwarded
    // any more. Fire-and-forget: guard() only proves wc was alive at EVENT
    // time; sendToChrome resolves the chrome at SEND time, so a tab closed
    // mid-fetch simply drops the send (forget(wcId) at teardown prevents the
    // per-tab sequence map from growing unbounded).
    wc.on(
      'page-favicon-updated',
      guard((_event, favicons) => {
        faviconFetcher
          .request({ wcId, favicons, fetchImpl: (url) => wc.session.fetch(url) })
          .then((dataUrl) => {
            if (dataUrl) sendToChrome('tab-favicon', { wcId, favicons: [dataUrl] });
          })
          .catch(() => {});
      })
    );
    wc.on(
      'did-start-loading',
      guard(() => {
        sendToChrome('tab-loading', { wcId, loading: true });
      })
    );
    wc.on(
      'did-stop-loading',
      guard(() => {
        sendToChrome('tab-loading', { wcId, loading: false });
      })
    );
    wc.on(
      'did-finish-load',
      guard(() => {
        sendToChrome('tab-did-finish-load', { wcId });
        sendToChrome('tab-nav-state', {
          wcId,
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward()
        });
        // Mission 20 Flight 2 Leg 1 (#216, DD12): the F1 speculative reassert that
        // used to live here (a second `wc.isFocused()` check for the error
        // document's own commit) is REMOVED — dead per the leg-1 live diagnostic
        // run, which found a `focus`/`blur` cycle on the guest starting
        // asynchronously right after `wc.loadURL()`, well before this event ever
        // fires. The debrief already recorded this exact reassert as ineffective
        // ("did not change the observed behavior"). The chrome-blur listener in
        // window-factory.js is the sole remaining reassert mechanism.
      })
    );
    wc.on(
      'dom-ready',
      guard(() => {
        sendToChrome('tab-dom-ready', { wcId, tabWcId: wcId });
      })
    );
    wc.on(
      'found-in-page',
      guard((_event, result) => {
        const findOverlay = registry.getWindowForGuest(wcId)?.findOverlay;
        if (!findOverlay || !findOverlay.isSessionActive(wcId)) return;
        const overlayView = findOverlay.getView();
        if (!overlayView || overlayView.webContents.isDestroyed()) return;
        overlayView.webContents.send?.('find-overlay:count', {
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches
        });
      })
    );
  }

  return { wireGuestContents, wireTabViewEvents };
}

module.exports = { createGuestWiring, qualifiesAsPopupRequest };
