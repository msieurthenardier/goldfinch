// The load-failure surface's own controller (Mission 20 Flight 1 Leg 2, DD1).
// Chrome DOM nested inside #webviews (index.html), shown while the active
// tab's own navigation has failed (tab-controller.js's activateTab calls
// show()/hide() on every activation-class event, mirroring
// welcome-controller.js's show()/hide() pair) and hidden otherwise. Built
// once with createElement/textContent — no innerHTML from data. The
// controller self-subscribes to bridge.onTabLoadFailure (DD1/AC2) — it is the
// one place that reacts to the main-pushed failure/clear transition.

// Mission 20 Flight 2 Leg 2 (DD4/AC10): classifyCertError is imported HERE,
// directly — NOT threaded as a renderer.js-injected dep like classifyLoadFailure
// — the leg's renderer.js line budget has room for exactly two new
// createSiteSecurityController keys and no more, so this controller reaches
// for the shared module itself (the failedTabTitle precedent, one line below).
import { failedTabTitle, classifyCertError, classifyCrash, deriveStripLoadState } from '../../shared/load-failure.js';

/** @param {any} deps */
export function createLoadFailureController(deps) {
  const {
    document,
    els,
    bridge,
    findTabByWcId,
    isActiveTab,
    classifyLoadFailure,
    refreshTabIndicators, // Mission 20 F3 Leg 1 (DD11): the single chip-refresh owner (site-security-controller.js)
    onAdvanced,
    onViewCertificate // Mission 20 Flight 2 Leg 4 (DD9): the View certificate button's opener
  } = deps;

  const root = els.loadFailureSurface;
  root.textContent = '';

  const column = document.createElement('div');
  column.className = 'load-failure-column';
  root.appendChild(column);

  // HAT H1 fix 1: a Chrome-interstitial-style icon above the heading —
  // additive, decorative only (aria-hidden), built from plain nested divs and
  // styled entirely in CSS off the `data-failure-kind` attribute `render()`
  // already sets/deletes below. NOT inline SVG (createElementNS has no
  // fake-DOM harness double and this module is exercised there) and NOT a
  // glyph/text run (a "!" rendered as text — real or CSS `content` — would be
  // a color-contrast node axe evaluates against this decorative red; plain
  // colored boxes carry no text semantics at all). Both variants are always
  // present in the DOM; CSS shows exactly one per `data-failure-kind`.
  const icon = document.createElement('div');
  icon.className = 'lf-icon';
  icon.setAttribute('aria-hidden', 'true');
  column.appendChild(icon);

  const iconCert = document.createElement('div');
  iconCert.className = 'lf-icon-cert';
  const iconCertBar = document.createElement('div');
  iconCertBar.className = 'lf-icon-cert-bar';
  const iconCertDot = document.createElement('div');
  iconCertDot.className = 'lf-icon-cert-dot';
  iconCert.appendChild(iconCertBar);
  iconCert.appendChild(iconCertDot);
  icon.appendChild(iconCert);

  const iconNetwork = document.createElement('div');
  iconNetwork.className = 'lf-icon-network';
  icon.appendChild(iconNetwork);

  // tabindex="-1" (AC1/DD6): a programmatic focus target, never in the Tab
  // order on its own — F6 and the failure-lands-while-active case both move
  // focus here explicitly.
  const heading = document.createElement('h2');
  heading.id = 'load-failure-heading';
  heading.tabIndex = -1;
  column.appendChild(heading);

  const body = document.createElement('p');
  body.id = 'load-failure-body';
  column.appendChild(body);

  const urlLine = document.createElement('p');
  urlLine.id = 'load-failure-url';
  column.appendChild(urlLine);

  const codeLine = document.createElement('p');
  codeLine.id = 'load-failure-code';
  column.appendChild(codeLine);

  // HAT H1 fix 1: the button row is a new wrapper (`.lf-actions`) purely for
  // layout — Retry/View certificate/Advanced are still appended to it in the
  // SAME order as before, so the frozen DOM/tab-order contract (heading →
  // Retry → View certificate → Advanced) is unchanged; visual order still
  // equals focus order (no CSS `order` used anywhere on this row).
  const actions = document.createElement('div');
  actions.className = 'lf-actions';
  column.appendChild(actions);

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.id = 'load-failure-retry';
  retry.textContent = 'Retry';
  retry.classList.add('gf-btn', 'gf-btn-primary');
  actions.appendChild(retry);

  // Mission 20 Flight 3 Leg 2 (DD1): Reload — the crash branch's ONLY
  // action, additive contract hook. Distinct from Retry: a failed load
  // retries the INTENDED address; a crash reloads the CURRENT history entry
  // (`wc.reload()` respawns the renderer in place — spike (d), history
  // intact). Hidden outside the crash branch.
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.id = 'load-failure-reload';
  reload.textContent = 'Reload';
  reload.classList.add('hidden', 'gf-btn', 'gf-btn-primary');
  actions.appendChild(reload);

  // Mission 20 Flight 2 Leg 4 (DD9): View certificate — opens the read-only
  // cert-viewer sheet card for the panel's current tab. Shown for ANY cert
  // failure (overridable or not — the viewer is informational, unlike
  // Advanced which only proceeds past a bypassable error). Tab order:
  // heading → Retry → View certificate → Advanced (DOM order below).
  const viewCert = document.createElement('button');
  viewCert.type = 'button';
  viewCert.id = 'load-failure-view-cert';
  viewCert.textContent = 'View certificate';
  viewCert.classList.add('hidden', 'gf-btn', 'gf-btn-outline');
  actions.appendChild(viewCert);

  // Mission 20 Flight 2 Leg 3 (DD3/DD4): the ADDITIVE Advanced hook — opens
  // the cert-override sheet card. Shown ONLY for an overridable cert failure
  // (AC5); hidden for revoked/pinned/invalid, where the body copy already
  // says the error cannot be bypassed. Distinct from Retry (try the same
  // address again) — Advanced proceeds despite the error.
  const advanced = document.createElement('button');
  advanced.type = 'button';
  advanced.id = 'load-failure-advanced';
  advanced.textContent = 'Advanced';
  advanced.classList.add('hidden', 'gf-btn', 'gf-btn-outline');
  actions.appendChild(advanced);

  // HAT H1 fix 1: the Goldfinch brand mark — unobtrusive, bottom-left of the
  // column, the welcome-controller.js `.welcome-mark` precedent (same asset,
  // decorative `alt=""` since the wordmark span carries the visible name).
  const brand = document.createElement('div');
  brand.className = 'lf-brand';
  const brandMark = /** @type {HTMLImageElement} */ (document.createElement('img'));
  brandMark.className = 'lf-brand-mark';
  brandMark.src = 'assets/goldfinch_color.png';
  brandMark.alt = '';
  brand.appendChild(brandMark);
  const brandName = document.createElement('span');
  brandName.className = 'lf-brand-name';
  brandName.textContent = 'Goldfinch';
  brand.appendChild(brandName);
  column.appendChild(brand);

  /** @type {any} */
  let currentTab = null;

  // formatFailureCode(failure): the code line reads "<name> (<code>)" when
  // both are present (HAT H1 fix 1 — the operator needs the numeric net-error
  // code alongside the engine name for reporting/lookup, e.g.
  // "ERR_CONNECTION_REFUSED (-102)"); a missing name falls back to "(<code>)",
  // a missing/non-finite code falls back to the bare name, and both missing
  // renders nothing. The name stays verbatim and FIRST so the behavior spec's
  // raw-name substring assertion keeps passing.
  /** @param {any} failure
   *  @returns {string} */
  function formatFailureCode(failure) {
    const name = failure && typeof failure.name === 'string' && failure.name ? failure.name : null;
    const code = failure && typeof failure.code === 'number' && Number.isFinite(failure.code) ? failure.code : null;
    if (name && code !== null) return `${name} (${code})`;
    if (code !== null) return `(${code})`;
    if (name) return name;
    return '';
  }

  // render(tab): reads classifyLoadFailure(tab.loadFailure) / classifyCrash /
  // classifyCertError and writes every line via textContent only — engine
  // strings (the raw `name`/`reason`) and the intended address are
  // user/page-adjacent data, never markup (house rule).
  //
  // Mission 20 Flight 3 Leg 2 (DD1): the crash branch is checked FIRST —
  // exclusive with a load failure by construction (the crash handler clears
  // `loadFailure` in the same step it stamps `crash`), never both at once.
  // Retry / View certificate / Advanced are all hidden for a crash; Reload
  // is its one action.
  /** @param {any} tab */
  function render(tab) {
    const crash = tab && tab.crash;
    const failure = !crash && tab && tab.loadFailure;
    const cert = failure && failure.cert;
    // Mission 20 Flight 2 Leg 2 (DD4): cert branch — title/body come from
    // classifyCertError(failure.cert.error), never classifyLoadFailure (which
    // would classify the SAME ERR_CERT_* name back into the generic 'cert'
    // kind's copy). The code line (name + numeric code) is UNCHANGED either
    // way — formatFailureCode reads the top-level failure.name/code, which
    // guest-wiring.js never touches when folding.
    const classification = crash
      ? classifyCrash(crash.reason)
      : cert
        ? classifyCertError(cert.error)
        : classifyLoadFailure(failure);
    heading.textContent = crash ? classification.heading : classification.title;
    body.textContent = classification.body;
    urlLine.textContent = (crash && crash.url) || (failure && failure.url) || (tab && tab.url) || '';
    codeLine.textContent = crash
      ? formatFailureCode({ name: crash.reason, code: crash.exitCode })
      : formatFailureCode(failure);
    // Retry is always shown for a cert failure (DD4 — a transient
    // interception clears on retry); otherwise the ordinary retryable flag;
    // always hidden for a crash (Reload is the crash's one action).
    retry.classList.toggle('hidden', crash ? true : cert ? false : !classification.retryable);
    // View certificate (DD9): shown for ANY cert failure, overridable or not
    // — informational, never gated on overridable the way Advanced is; never
    // shown for a crash (no certificate is involved).
    viewCert.classList.toggle('hidden', crash ? true : !cert);
    // Advanced (AC5): shown ONLY for an overridable cert failure — hidden for
    // every other failure kind AND for a non-overridable cert kind
    // (revoked/pinned/invalid), where classifyCertError's own body copy
    // already says the error cannot be bypassed; never shown for a crash.
    advanced.classList.toggle('hidden', crash ? true : !(cert && classification.overridable));
    // Reload (DD1): shown ONLY for the crash branch.
    reload.classList.toggle('hidden', !crash);
    // CSS hook for leg 4's styling + the a11y audit's state selector — present
    // only while the panel shows a crash or a cert failure.
    if (crash) root.dataset.failureKind = 'crash';
    else if (cert) root.dataset.failureKind = 'cert';
    else delete root.dataset.failureKind;
  }

  /** @param {any} tab */
  function show(tab) {
    currentTab = tab;
    render(tab);
    root.classList.remove('hidden');
  }

  function hide() {
    currentTab = null;
    root.classList.add('hidden');
  }

  // focusHeading(): the F6 target (DD6) and the failure-lands-on-active-tab
  // orphan-focus guard (AC2) both call this — Retry is never auto-focused.
  function focusHeading() {
    heading.focus();
  }

  // applyStripState(tab) is the ONLY writer of `data-load-state` / the
  // `.tab-status` span (Implementation Guidance #3) — called for every
  // failure/crash/hang/clear push regardless of whether the tab is active, so
  // the strip never lags a background transition (behavior spec steps 4-5).
  //
  // Mission 20 Flight 3 Leg 2 (DD1): the ONE strip-state derivation is
  // `deriveStripLoadState(tab)` (crashed > failed > hung > null) — this is
  // the sole `dataset.loadState =` write site, and its value comes from that
  // one function, never a field-scoped literal racing another writer.
  /** @param {any} tab */
  function applyStripState(tab) {
    if (!tab || !tab.btn) return;
    const statusEl = tab.btn.querySelector('.tab-status');
    const titleEl = tab.btn.querySelector('.tab-title');
    const closeEl = tab.btn.querySelector('.tab-close');
    const state = deriveStripLoadState(tab);
    if (state) tab.btn.dataset.loadState = state;
    else delete tab.btn.dataset.loadState;

    if (state === 'crashed' || state === 'failed') {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = '⚠';
      }
      const host = failedTabTitle(tab);
      if (titleEl) titleEl.textContent = host;
      tab.btn.title = host;
      const label = `${host} — ${state === 'crashed' ? 'crashed' : 'failed to load'}`;
      tab.btn.setAttribute('aria-label', label);
      if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${label}`);
      return;
    }
    if (state === 'hung') {
      // HAT leg-5 fix (H1): plain ASCII, not the hourglass — the hourglass
      // (U+231B) renders as tofu on Linux/WSLg's default font stack, and the
      // accessible name below (`— not responding`) is the real signal per
      // the state-in-words rule, so the glyph itself can safely be the
      // simplest thing that's guaranteed to render everywhere. Amber comes
      // from CSS keyed off `data-load-state='hung'` (styles.css).
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = '!';
      }
      const name = tab.title || tab.url;
      if (titleEl) titleEl.textContent = name;
      tab.btn.title = name || '';
      const label = `${name} — not responding`;
      tab.btn.setAttribute('aria-label', label);
      if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${label}`);
      return;
    }
    // null — cleared. Re-derive exactly as renderer.js's onTabTitle does on
    // an ordinary push.
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.textContent = '';
    }
    const name = tab.title || tab.url;
    if (titleEl) titleEl.textContent = name;
    tab.btn.title = name || '';
    tab.btn.setAttribute('aria-label', name);
    if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${name}`);
  }

  // Retry (AC6): navigates the tab the panel currently shows via the
  // recorded intended address — never the address bar's navigate()/toUrl,
  // which would re-run search-vs-URL resolution over an address that already
  // parsed as a URL once. main clears the failure on did-start-navigation and
  // the resulting null push hides this panel (AC2).
  retry.addEventListener('click', () => {
    const tab = currentTab;
    if (!tab || !tab.loadFailure || tab.wcId == null) return;
    bridge.tabNavigate({ wcId: tab.wcId, verb: 'loadURL', args: [tab.loadFailure.url || tab.url] });
  });

  // Reload (DD1): respawns the crashed renderer in place — main's `reload`
  // verb calls `wc.reload()` (history intact, spike (d)); the resulting
  // navigation clears `entry.crash` and pushes `tab-crash null`, hiding this
  // panel (AC2's clear-transition precedent).
  reload.addEventListener('click', () => {
    const tab = currentTab;
    if (!tab || !tab.crash || tab.wcId == null) return;
    bridge.tabNavigate({ wcId: tab.wcId, verb: 'reload' });
  });

  // View certificate (DD9): opens the read-only cert-viewer sheet card for
  // the panel's CURRENT tab — onViewCertificate is the site-security
  // controller's opener (injected; construction-order late-bound closure,
  // renderer.js, the onAdvanced precedent).
  viewCert.addEventListener('click', () => {
    const tab = currentTab;
    if (!tab || !tab.loadFailure || !tab.loadFailure.cert) return;
    onViewCertificate?.(tab);
  });

  // Advanced (DD3): opens the cert-override sheet card for the panel's
  // CURRENT tab — `onAdvanced` is the site-security controller's opener
  // (injected; construction-order late-bound closure, renderer.js).
  advanced.addEventListener('click', () => {
    const tab = currentTab;
    if (!tab || !tab.loadFailure || !tab.loadFailure.cert) return;
    onAdvanced?.(tab);
  });

  // The controller subscribes to the owner-routed push itself (DD1) — no
  // other file reacts to tab-load-failure.
  bridge.onTabLoadFailure(({ wcId, failure }) => {
    const tab = findTabByWcId(wcId);
    if (!tab) return; // unknown wcId (e.g. onViewCreated pending) — no-op
    // DD4/DD6/DD7: `did-navigate` never fires for the error commit (leg-1
    // spike finding (b)), so a re-navigate on an EXISTING tab would otherwise
    // leave `tab.url` stale at whatever it was before — wrong for the address
    // bar on the next activation and for the census. The push's own
    // `failure.url` (main's `lastRequestedUrl`) is the intended address.
    if (failure && failure.url) tab.url = failure.url;
    tab.loadFailure = failure || null;
    // Mission 20 Flight 3 Leg 2 (DD1): a crash then a fresh failed load —
    // the crash is exclusive with a load failure (never both at once).
    if (failure) tab.crash = null;
    applyStripState(tab);
    if (!isActiveTab(tab)) return;
    if (failure) {
      show(tab);
      // F1 (post-acceptance fix pass): a programmatic re-navigation of an
      // already-open ACTIVE tab never fires did-navigate on failure (DD4/DD6),
      // so the address bar/chip would otherwise keep whatever was previously
      // committed — mirror activateTab's own sync.
      //
      // tls-trust-surface checkpoint 2 (acceptance-run F1): the chip write
      // must NOT share the address-value guard below. The chip refresh maps
      // a set tab.loadFailure to security 'none' regardless of focus — a
      // security indicator has to reflect real state even while the operator
      // is typing/focused in the address bar (a new tab autofocuses it), or
      // an untrusted-cert interstitial renders behind a stale green lock.
      // Only the VALUE write — which would clobber in-progress typing — stays
      // behind the activeElement guard. `force: true` (CLAUDE.md "Chrome
      // indicators" rule (c)): this push refreshes the chip UNCONDITIONALLY —
      // this call site is already gated to the active tab by the `return`
      // above, but forcing documents the rule directly at its one canonical
      // call site rather than relying on the surrounding gate.
      refreshTabIndicators(tab, { force: true });
      if (document.activeElement !== els.address) {
        els.address.value = tab.url;
      }
      // Focus the panel only when no chrome control already holds focus (the
      // typed-Enter pendingFocusGuest case, which never resolves for a
      // failed load) — never steal focus from an operator mid-interaction.
      if (document.activeElement === null || document.activeElement === document.body) {
        focusHeading();
      }
    } else {
      hide();
    }
  });

  // Mission 20 Flight 3 Leg 2 (DD1): the crash push — the onTabLoadFailure
  // shape above, registered by this same controller (no other file reacts to
  // tab-crash).
  bridge.onTabCrash(({ wcId, crash }) => {
    const tab = findTabByWcId(wcId);
    if (!tab) return; // unknown wcId — no-op
    if (crash && crash.url) tab.url = crash.url;
    tab.crash = crash || null;
    // A dead renderer is neither failed nor hung — the error document it may
    // have been showing died with it (DD1's exclusivity rule).
    if (crash) {
      tab.loadFailure = null;
      tab.hung = false;
    }
    applyStripState(tab);
    if (!isActiveTab(tab)) return;
    if (crash) {
      show(tab);
      refreshTabIndicators(tab, { force: true });
      if (document.activeElement !== els.address) {
        els.address.value = tab.url;
      }
      if (document.activeElement === null || document.activeElement === document.body) {
        focusHeading();
      }
    } else {
      hide();
    }
  });

  // onTabDidNavigate(tab): HAT H2b fix. A renderer that just committed a
  // navigation is neither crashed nor hung — but `showCrashPanelForAudit()`
  // (renderer.js) stamps a SYNTHETIC `tab.crash` chrome-side that main never
  // knows about, so main's own did-start-navigation clear-and-push-null
  // (guest-wiring.js) never fires for it and the synthetic record (and this
  // panel, and the census's `crashed` loadState) would otherwise outlive the
  // navigation that superseded it. Called from renderer.js's own
  // onTabDidNavigate handler for every committed nav, real or post-synthetic;
  // a REAL crash has already been cleared by main's `tab-crash null` push by
  // the time did-navigate fires (did-start-navigation always precedes
  // did-navigate), so this is a harmless no-op in that case.
  /** @param {any} tab */
  function onTabDidNavigate(tab) {
    if (!tab || !tab.crash) return;
    tab.crash = null;
    applyStripState(tab);
    if (currentTab === tab) hide();
  }

  return { show, hide, focusHeading, applyStripState, onTabDidNavigate };
}
