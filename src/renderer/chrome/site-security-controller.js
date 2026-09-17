// Mission 20 Flight 2 Leg 1 (DD11 seed): the site-info chip's glue, extracted
// out of renderer.js verbatim (a behaviour-preserving move) as the seed for
// this flight's TLS trust work — legs 3-4 grow it with the cert-override card
// and the cert-viewer opener. Chained ahead of the generic dispatch exactly
// like vault-controller.js / downloads-controller.js: `handleActivation`
// joins the onActivated short-circuit at the CALL SITE (renderer.js), and
// `handleClosed` sits beside vaultController.handleClosed in
// handleOverlayClosed.
'use strict';

import { classifyCertError } from '../../shared/load-failure.js';

/**
 * @param {{
 *   els: any,
 *   openOverlayMenu: (menuType: string, model: any, anchor: any, startIndex: number, opts?: any) => void,
 *   siteInfoModel: (tab: any) => any,
 *   activeTab: () => any,
 *   overlayTriggerClick: (menuType: string, open: () => void) => void,
 *   leftAnchorOf: (el: HTMLElement) => any,
 *   openSiteSettingsTab: () => any,
 *   bridge: any,
 *   findTabByWcId: (wcId: number) => any,
 *   closeOverlayMenu: (reason: string) => void,
 *   isActiveTab: (tab: any) => boolean,
 *   updateAddressChip: (tab: any) => void
 * }} deps  Mission 20 Flight 2 Leg 4 (DD9): `bridge` also carries
 *   `tabCertificateGet({ wcId })`, read by openCertificateViewer.
 *   Acceptance-run fix pass F3 (tls-trust-surface checkpoint 6): `isActiveTab`
 *   / `updateAddressChip` — the load-failure-controller.js F1 fix-pass shape
 *   — let the `tab-security` push refresh the chip for the tab it landed on,
 *   instead of leaving it stale until the next unrelated chip sync.
 */
export function createSiteSecurityController({
  els,
  openOverlayMenu,
  siteInfoModel,
  activeTab,
  overlayTriggerClick,
  leftAnchorOf,
  openSiteSettingsTab,
  // Mission 20 Flight 2 Leg 2 (DD7): the two keys this leg's AC10 names —
  // `bridge` subscribes the owner-routed `tab-security` push, `findTabByWcId`
  // resolves it (a background tab's push cannot be resolved through
  // activeTab()).
  bridge,
  findTabByWcId,
  // Mission 20 Flight 2 Leg 3 (DD3): the navigation-away close for an open
  // cert-override card — the entry gate in register-overlay-ipc.js already
  // makes a stale proceed a no-op; this just keeps the card from outliving
  // its own question.
  closeOverlayMenu,
  isActiveTab,
  updateAddressChip
}) {
  const siteInfoAnchor = () => leftAnchorOf(els.addressChip);

  // Site-info model derived from the active tab via the shared deriveSiteInfo
  // (the one derivation source). startIndex is meaningless for the no-items
  // popup — the sheet focuses the "Site settings →" action.
  const openSiteInfoOverlay = () => openOverlayMenu('site-info', siteInfoModel(activeTab()), siteInfoAnchor(), 0);

  // 🔒 site-info chip (Leg 3): click toggle + trigger keydown — the chip's own
  // keydown handler below registers Enter/Space/ArrowDown/ArrowUp (startIndex is
  // moot for the popup, so all four keys open the same way).
  els.addressChip.addEventListener('click', () => overlayTriggerClick('site-info', openSiteInfoOverlay));
  els.addressChip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openSiteInfoOverlay();
    }
  });

  // Tracks whether the cert-override card is the one this controller opened —
  // read by the navigation-away close below and cleared by handleClosed.
  let certOverrideOpen = false;

  // Mission 20 Flight 2 Leg 3 (DD3): opens the cert-override sheet card for
  // the given tab — the load-failure panel's OWN current tab, passed in by
  // its Advanced click handler (never re-derived from activeTab() here,
  // matching how the panel resolves its own state). A tab with no folded
  // cert failure is a no-op (defensive; the panel's own click handler
  // already guards this).
  function openCertOverrideOverlay(tab) {
    const cert = tab && tab.loadFailure && tab.loadFailure.cert;
    if (!cert) return;
    const classification = classifyCertError(cert.error);
    certOverrideOpen = true;
    openOverlayMenu(
      'cert-override',
      { host: cert.host, error: cert.error, title: classification.title, body: classification.body },
      null,
      0
    );
  }

  // Mission 20 Flight 2 Leg 4 (DD9): opens the read-only cert-viewer sheet
  // card for `tab` (defaults to the active tab — the popup's Certificate
  // action; the interstitial's View-certificate button passes its OWN
  // current tab, matching openCertOverrideOverlay's shape). A tab with no
  // live wcId (internal/blank) never round-trips — opens the "unavailable"
  // model directly (the popup already gates the action on showCertificate,
  // but the interstitial's/audit's callers have no such gate). Async: after
  // the bridge read resolves, re-check the ACTIVE tab is still the one this
  // call started for (edge case: a tab switch mid-fetch must not open a
  // card for an off-screen tab) — dropped silently otherwise, never opened.
  async function openCertificateViewer(tab = activeTab()) {
    if (!tab || tab.wcId == null) {
      openOverlayMenu('cert-viewer', null, siteInfoAnchor(), 0);
      return;
    }
    const requestedId = tab.id;
    let summary;
    try {
      summary = await bridge.tabCertificateGet({ wcId: tab.wcId });
    } catch {
      summary = null; // a rejected invoke degrades to the "unavailable" model, never a throw
    }
    const current = activeTab();
    if (!current || current.id !== requestedId) return; // tab switched mid-fetch — drop
    openOverlayMenu('cert-viewer', summary, siteInfoAnchor(), 0);
  }

  /**
   * Chained ahead of the generic dispatchOverlayActivation switch (the
   * vault/downloads precedent) — returns true when this controller consumed
   * the activation, so the caller skips the generic dispatch entirely.
   * @param {{ menuType: string, id: string, value?: any }} payload
   * @returns {boolean}
   */
  function handleActivation({ menuType, id }) {
    // DD3: channel-4 `menu-overlay:activated` never carries a proceed for
    // this menuType (the dedicated menu-overlay:cert-override-proceed invoke
    // does) — a validated no-op that still short-circuits the generic
    // dispatch, exactly like every other consumed menuType here.
    if (menuType === 'cert-override') return true;
    // Mission 20 Flight 2 Leg 4 (DD9): cert-viewer is read-only and carries
    // no action items — a validated no-op, exactly like cert-override.
    if (menuType === 'cert-viewer') return true;
    if (menuType !== 'site-info') return false;
    if (id === 'certificate') openCertificateViewer();
    else if (id === 'site-settings') openSiteSettingsTab();
    return true;
  }

  // Mission 20 Flight 2 Leg 3 (DD3): navigation-away closes an open
  // cert-override card — the register-overlay-ipc.js entry gate already
  // makes a stale proceed a no-op; this just keeps the card from outliving
  // its own question. Scoped to (a) the card actually being open and (b) the
  // ACTIVE tab only — a background tab's failure clearing or navigating must
  // never close a card the operator is looking at for a DIFFERENT tab.
  bridge.onTabLoadFailure(({ wcId, failure }) => {
    if (!certOverrideOpen || failure) return; // only a CLEAR (null) is navigation-away
    const tab = activeTab();
    if (!tab || tab.wcId !== wcId) return;
    closeOverlayMenu('navigation');
  });
  bridge.onTabDidNavigate(({ wcId }) => {
    if (!certOverrideOpen) return;
    const tab = activeTab();
    if (!tab || tab.wcId !== wcId) return;
    closeOverlayMenu('navigation');
  });

  // Mission 20 Flight 2 Leg 2 (DD7): the owner-routed `tab-security` push —
  // its OWN channel (never riding tab-did-navigate; see guest-wiring.js). The
  // controller is the natural owner (leg-1 seed note) and the sole subscriber.
  bridge.onTabSecurity(({ wcId, security }) => {
    const tab = findTabByWcId(wcId);
    if (!tab) return; // unknown wcId (e.g. onViewCreated pending) — no-op
    tab.security = security;
    // Acceptance-run fix pass F3 (tls-trust-surface checkpoint 6): this push
    // lands AFTER tab-did-navigate's own chip refresh (guest-wiring.js pushes
    // did-navigate first), so the chip that call drew is stale by the time
    // the real security state arrives. Re-sync it here — but only for the
    // ACTIVE tab; a background tab's push must not touch the visible chip.
    refreshTabIndicators(tab);
  });

  // Mission 20 Flight 3 Leg 1 (DD11): the single chip-refresh owner — folds
  // the five independent updateAddressChip call sites the Flight 2 debrief
  // flagged (recommendation 2) behind one function. Active-tab-guarded by
  // default; `{ force: true }` is CLAUDE.md's "Chrome indicators" rule (c) —
  // the load-failure push's chip write must reflect real state even for a
  // tab the operator is mid-typing in, so it alone forces the refresh
  // regardless of activation.
  /** @param {any} tab @param {{ force?: boolean }} [opts] */
  function refreshTabIndicators(tab, { force } = {}) {
    if (force || isActiveTab(tab)) updateAddressChip(tab);
  }

  /**
   * Chained beside vaultController.handleClosed in handleOverlayClosed.
   * Mission 20 Flight 2 Leg 3 (DD3): clears the cert-override open flag on
   * ANY close of that menuType (activated/escape/outside-click/blur/
   * navigation/tab-switch/…) — the card's own lifecycle, not a
   * reason-specific branch. Every other menuType still no-ops (cert-viewer
   * has no close-side state yet).
   * @param {{ menuType: string, reason: string }} payload
   */
  function handleClosed({ menuType }) {
    if (menuType === 'cert-override') certOverrideOpen = false;
  }

  return {
    openSiteInfoOverlay,
    openCertOverrideOverlay,
    openCertificateViewer,
    handleActivation,
    handleClosed,
    refreshTabIndicators
  };
}
