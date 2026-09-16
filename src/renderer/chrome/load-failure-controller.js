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
import { failedTabTitle, classifyCertError } from '../../shared/load-failure.js';

/** @param {any} deps */
export function createLoadFailureController(deps) {
  const {
    document,
    els,
    bridge,
    findTabByWcId,
    isActiveTab,
    classifyLoadFailure,
    updateAddressChip,
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
  retry.classList.add('lf-btn', 'lf-btn-primary');
  actions.appendChild(retry);

  // Mission 20 Flight 2 Leg 4 (DD9): View certificate — opens the read-only
  // cert-viewer sheet card for the panel's current tab. Shown for ANY cert
  // failure (overridable or not — the viewer is informational, unlike
  // Advanced which only proceeds past a bypassable error). Tab order:
  // heading → Retry → View certificate → Advanced (DOM order below).
  const viewCert = document.createElement('button');
  viewCert.type = 'button';
  viewCert.id = 'load-failure-view-cert';
  viewCert.textContent = 'View certificate';
  viewCert.classList.add('hidden', 'lf-btn', 'lf-btn-outline');
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
  advanced.classList.add('hidden', 'lf-btn', 'lf-btn-outline');
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

  // render(tab): reads classifyLoadFailure(tab.loadFailure) and writes every
  // line via textContent only — engine strings (the raw `name`) and the
  // intended address are user/page-adjacent data, never markup (house rule).
  /** @param {any} tab */
  function render(tab) {
    const failure = tab && tab.loadFailure;
    const cert = failure && failure.cert;
    // Mission 20 Flight 2 Leg 2 (DD4): cert branch — title/body come from
    // classifyCertError(failure.cert.error), never classifyLoadFailure (which
    // would classify the SAME ERR_CERT_* name back into the generic 'cert'
    // kind's copy). The code line (name + numeric code) is UNCHANGED either
    // way — formatFailureCode reads the top-level failure.name/code, which
    // guest-wiring.js never touches when folding.
    const classification = cert ? classifyCertError(cert.error) : classifyLoadFailure(failure);
    heading.textContent = classification.title;
    body.textContent = classification.body;
    urlLine.textContent = (failure && failure.url) || (tab && tab.url) || '';
    codeLine.textContent = formatFailureCode(failure);
    // Retry is always shown for a cert failure (DD4 — a transient
    // interception clears on retry); otherwise the ordinary retryable flag.
    retry.classList.toggle('hidden', cert ? false : !classification.retryable);
    // View certificate (DD9): shown for ANY cert failure, overridable or not
    // — informational, never gated on overridable the way Advanced is.
    viewCert.classList.toggle('hidden', !cert);
    // Advanced (AC5): shown ONLY for an overridable cert failure — hidden for
    // every other failure kind AND for a non-overridable cert kind
    // (revoked/pinned/invalid), where classifyCertError's own body copy
    // already says the error cannot be bypassed.
    advanced.classList.toggle('hidden', !(cert && classification.overridable));
    // CSS hook for leg 4's styling + the a11y audit's state selector — present
    // only while the panel shows a cert failure.
    if (cert) root.dataset.failureKind = 'cert';
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
  // failure/clear push regardless of whether the tab is active, so the strip
  // never lags a background failure (behavior spec steps 4-5).
  /** @param {any} tab */
  function applyStripState(tab) {
    if (!tab || !tab.btn) return;
    const statusEl = tab.btn.querySelector('.tab-status');
    const titleEl = tab.btn.querySelector('.tab-title');
    const closeEl = tab.btn.querySelector('.tab-close');
    if (tab.loadFailure) {
      tab.btn.dataset.loadState = 'failed';
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = '⚠';
      }
      const host = failedTabTitle(tab);
      if (titleEl) titleEl.textContent = host;
      tab.btn.title = host;
      const label = `${host} — failed to load`;
      tab.btn.setAttribute('aria-label', label);
      if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${label}`);
    } else {
      delete tab.btn.dataset.loadState;
      if (statusEl) {
        statusEl.hidden = true;
        statusEl.textContent = '';
      }
      // Re-derive exactly as renderer.js's onTabTitle does on an ordinary push.
      const name = tab.title || tab.url;
      if (titleEl) titleEl.textContent = name;
      tab.btn.title = name || '';
      tab.btn.setAttribute('aria-label', name);
      if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${name}`);
    }
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
      // must NOT share the address-value guard below. updateAddressChip maps
      // a set tab.loadFailure to security 'none' regardless of focus — a
      // security indicator has to reflect real state even while the operator
      // is typing/focused in the address bar (a new tab autofocuses it), or
      // an untrusted-cert interstitial renders behind a stale green lock.
      // Only the VALUE write — which would clobber in-progress typing — stays
      // behind the activeElement guard.
      updateAddressChip(tab);
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

  return { show, hide, focusHeading, applyStripState };
}
