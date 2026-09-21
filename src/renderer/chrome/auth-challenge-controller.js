// @ts-check

/**
 * Owns the HTTP basic-auth + TLS client-cert challenge presentation flow (M14 F1
 * L2/L3) — extracted from renderer.js (Mission 21 Flight 3 Leg 1, "sheet-type-
 * dispatch", banked line-budget headroom for the identity family). Adjacent to
 * the vault flow but deliberately kept in its own module rather than folded into
 * `vault-controller.js` — flight DD3 (`missions/21-.../flights/03-.../flight.md`)
 * and `vault-controller.js`'s own header both draw that boundary on purpose.
 *
 * Built on the same shape as `vault-controller.js` / `downloads-controller.js`:
 * both subscriptions are wired INSIDE the factory body at construction time
 * (safe — the callbacks fire only asynchronously, once main's pending-challenge
 * store decides a challenge is eligible to present), and the factory returns
 * `{ overlayStates }` only — nothing else. `renderer.js` constructs this
 * controller and spreads its `overlayStates` into the shared `overlayMenus`
 * table, the same `...vaultController.overlayStates` precedent.
 *
 * NOT owned here: the no-op `auth-basic` / `cert-picker` channel-4 dispatch cases
 * (`chrome/overlay-dispatch.js` — selection resolves MAIN-SIDE for both, so the
 * chrome dispatch is a validated no-op) and the audit hooks
 * (`openAuthBasicOverlayForAudit` / `openCertPickerOverlayForAudit`, already
 * extracted to `chrome/audit-hooks.js` at M20 F2 Leg 1 — they call
 * `openOverlayMenu` directly with a synthetic model and do not depend on either
 * subscription below).
 *
 * @param {{
 *   goldfinch: any,
 *   openOverlayMenu: (menuType: string, model: any, anchor: any, startIndex?: number, opts?: any) => boolean
 * }} deps
 */
export function createAuthChallengeController({ goldfinch, openOverlayMenu }) {
  // HTTP auth challenge presentation (M14 F1 L2, flight DD2). Main's pending-
  // challenge store decides WHEN a challenge presents (eligibility + queue); the
  // chrome opens the auth-basic sheet through the standard open path with the
  // NON-SECRET {host, realm} model + the store-stamped `popup` marker flag (M14
  // F2 L2 DD5). The credential leaves only via the authSubmit Buffer channel.
  goldfinch.onAuthChallengePresent(({ host, realm, popup }) => {
    openOverlayMenu('auth-basic', { host, realm, ...(popup === true ? { popup: true } : {}) }, null, 0);
  });

  // Client-cert challenge presentation (M14 F1 L3, flight DD4): same store-
  // decides / chrome-opens contract as above. Display strings only — {subject,
  // issuer} rows + the requesting host (the sheet's site-attribution subtitle,
  // M14 F3 HAT fix); selection resolves MAIN-SIDE from the channel-4 index.
  goldfinch.onCertChallengePresent(({ certs, host, popup }) => {
    openOverlayMenu(
      'cert-picker',
      {
        certs: Array.isArray(certs) ? certs : [],
        ...(typeof host === 'string' && host ? { host } : {}),
        ...(popup === true ? { popup: true } : {})
      },
      null,
      0
    );
  });

  const overlayStates = {
    // HTTP basic-auth credential prompt (M14 F1 L2, flight DD2). Raised from main's
    // pending-challenge store (auth-challenge-present) — no chrome trigger element,
    // so no aria-expanded target and no trigger refocus. The close reason's DD2
    // lifecycle bucket (resolve vs re-present) is mapped MAIN-SIDE by the store's
    // manager close-observer; the chrome only opens.
    'auth-basic': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // TLS client-cert chooser (M14 F1 L3, flight DD4) — same shape as auth-basic:
    // raised from main's pending-challenge store (cert-challenge-present), no
    // chrome trigger element, close buckets mapped MAIN-SIDE by the store.
    'cert-picker': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    }
  };

  return { overlayStates };
}
