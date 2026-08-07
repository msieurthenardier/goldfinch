// @ts-check

import { buildVaultIndicatorModel } from '../../shared/vault-indicator-model.js';
import { parsePickIndex, MANAGE_ID } from '../../shared/vault-picker-template.js';

/**
 * Owns the human vault flow end to end (M12 F2-F4's pick-and-fill, chrome-unlock,
 * capture-save, first-run-setup, access-keys, export-import, and key-rotation legs) —
 * extracted from renderer.js (M15 F2 Leg 1, "renderer.js extraction remains banked
 * architecture debt" paid down). Built on the `createDownloadsController` shape
 * (`downloads-controller.js`): the chrome composition root supplies only the shared
 * overlay transport (late-bound — `overlayMenuClient` does not exist yet at this
 * controller's construction time, exactly the downloads-controller construction-order
 * problem) and the few cross-cutting reads this flow needs (jarsClient badge lookups,
 * isSafeColor, openVaultPage for the picker's "Manage passwords" footer).
 *
 * NOT owned here (M14 F1 auth/cert challenge flow — adjacent but distinct; stays in
 * renderer.js): onAuthChallengePresent / onCertChallengePresent, their overlay
 * states, no-op dispatch cases, and audit hooks.
 *
 * @param {{
 *   els: Record<string, any>,
 *   goldfinch: any,
 *   jarsClient: any,
 *   isSafeColor: (color: any) => boolean,
 *   openVaultPage: () => void,
 *   openOverlayMenu: (menuType: string, model: any, anchor: any, startIndex?: number, opts?: any) => boolean,
 *   toast?: (title: string, body: string) => void
 * }} deps
 */
export function createVaultController({
  els,
  goldfinch,
  jarsClient,
  isSafeColor,
  openVaultPage,
  openOverlayMenu,
  // Chrome toast surface (the bookmarks-client `toast` precedent). Optional so an
  // offline unit harness constructs without one; the no-op then simply says nothing.
  toast = () => {},
}) {
  // Human vault flow state machine (M12 F2 Leg 3 pick-and-fill, DD5/DD6). A TRUSTED
  // lock-icon gesture arrives as { wcId } (main-derived, no secret). From there:
  //   gesture → (unlock if locked, via the Leg-2 vault-unlock sheet) → pick (the
  //   badged vault-picker sheet) → fill (F1's vault-fill channel, in MAIN only).
  // The chrome never sees a password: the picker model is metadata, the selection is
  // an index, and vaultFillHuman resolves + dispatches the credential entirely in main.
  //
  // `pendingVaultFlow` is phase-tracked so an UNRELATED later unlock (the lock-state
  // broadcast also fires for recovery/admin unlock, and for other tabs) never springs
  // the picker on a stale tab — we continue to the picker only when we are the tab
  // mid-unlock (`phase === 'unlocking'`). Last-wins: a new gesture replaces it, and
  // opening a sheet model-replaces any open one.
  /** @type {{ wcId: number, phase: 'unlocking' | 'picking' } | null} */
  let pendingVaultFlow = null;
  /** @type {any[]} the last picker model — the index→item source for dispatch. */
  let lastPickerModel = [];
  /** @type {string | null} the held capture's id (Leg 4) — the dismiss-drop path needs
   * it when the vault-capture sheet closes without a save. */
  let pendingCaptureId = null;
  /** @type {string | null} the held capture awaiting an unlock-to-save (locked-vault submit):
   * onVaultLockState finalizes the save/update offer for it on a successful unlock. Cleared on
   * finalize OR on an abandoned unlock (the unlock sheet dismissed while still locked). */
  let pendingCaptureUnlock = null;
  // Vault lock indicator (M12 F2 Leg 2 chrome-unlock, DD10). A PURE projection of
  // the pushed `vault-lock-state` (single source of truth = vault-store MRK-present)
  // — never a cache. Hidden until the manager is set up; then locked / unlocked.
  // Leg 3 also STASHES the state (`lockState`) so the gesture handler can decide
  // unlock-first-vs-pick, and CONTINUES a mid-unlock flow to the picker.
  let vaultStatePushed = false;
  /** @type {{ setUp: boolean, unlocked: boolean }} the last-known lock state (stashed). */
  let lockState = { setUp: false, unlocked: false };

  /** Open the badged vault picker for a tab: read the origin-filtered, metadata-only
   * reachable items (in main) and raise the vault-picker sheet. Enriches each row with
   * a jar display-name badge (Global vs the jar's name) — the store returns vaultId only.
   * @param {number} wcId */
  async function openVaultPicker(wcId) {
    let model;
    try {
      model = await goldfinch.vaultReachableItems(wcId);
    } catch {
      model = [];
    }
    lastPickerModel = Array.isArray(model) ? model : [];
    // Badge enrichment: map each row's source vaultId to a display label for the sheet
    // (Global for the global vault, else the jar's name). Kept off the metadata read
    // (which returns vaultId only); dispatch still reads vaultId + id from the row.
    for (const row of lastPickerModel) {
      if (row && row.vaultId && row.vaultId !== 'global') {
        const jar = jarsClient.containers.find((/** @type {any} */ c) => c.id === row.vaultId);
        row.badgeLabel = jar ? jar.name : row.vaultId;
        // The jar's dot color tints the sheet's top-right chicklet. Guard the raw color
        // through isSafeColor before it ever reaches a style (never trust it into CSS);
        // Global (skipped here) and colorless/unsafe jars get the neutral chip.
        row.badgeColor = jar && isSafeColor(jar.color) ? jar.color : null;
      }
    }
    openOverlayMenu('vault-picker', lastPickerModel, null, 0);
  }

  // Open the vault-capture sheet from a resolved save/update offer (shared by the immediate
  // unlocked path and the unlock-to-save finalize below). Enriches the SAVE choices with jar
  // display labels; captureId rides INSIDE the model so the sheet's Save invoke carries it back.
  /** @param {string} captureId @param {any} model */
  function openCaptureSheet(captureId, model) {
    pendingCaptureId = captureId;
    const choices = Array.isArray(model.choices)
      ? model.choices.map((/** @type {string} */ vaultId) => {
          if (vaultId === 'global') return { vaultId, label: 'Global' };
          const jar = jarsClient.containers.find((/** @type {any} */ c) => c.id === vaultId);
          return { vaultId, label: jar ? jar.name : vaultId };
        })
      : [];
    openOverlayMenu('vault-capture', { ...model, choices, captureId }, null, 0);
  }

  // The unlock-to-save continuation produced no save sheet — tell the operator which of
  // main's four outcomes it was (`captureFinalize`'s discriminated reason), plus a
  // catch-all for a rejected invoke. 'unchanged' is the one that is NOT a failure: the
  // stored password already matches, so there is nothing to save — but silence there reads
  // exactly like a lost credential, which is why it speaks too.
  /** @param {any} reason */
  function reportNoCaptureOffer(reason) {
    pendingCaptureId = null;
    const copy = {
      unchanged: ['Nothing to save', 'That password is already saved in your vault.'],
      expired: ['Password not saved', 'The request expired before the vault was unlocked. Sign in again to save it.'],
      'tab-changed': ['Password not saved', 'The tab changed before the password could be saved.'],
      locked: ['Password not saved', 'The vault is locked.'],
    }[String(reason)] || ['Password not saved', 'The saved-password prompt could not be opened.'];
    toast(copy[0], copy[1]);
  }

  /** @param {{ setUp: boolean, unlocked: boolean }} state */
  function renderVaultIndicator(state) {
    const el = els.vaultIndicator;
    if (!el) return;
    const model = buildVaultIndicatorModel(state);
    el.classList.toggle('hidden', !model.visible);
    el.classList.toggle('vault-locked', model.visible && model.state === 'locked');
    el.classList.toggle('vault-unlocked', model.visible && model.state === 'unlocked');
    const label = model.visible && model.state === 'unlocked'
      ? 'Password manager unlocked'
      : 'Password manager locked';
    el.setAttribute('aria-label', label);
  }

  goldfinch.onVaultGesture(({ wcId }) => {
    if (!lockState.setUp) return; // manager not set up — no setup UI in F2 (DD; F3 owns setup).
    if (lockState.unlocked) {
      pendingVaultFlow = { wcId, phase: 'picking' };
      openVaultPicker(wcId);
    } else {
      // Locked → raise the Leg-2 unlock prompt first; onVaultLockState continues to the
      // picker on a successful unlock. openOverlayMenu is POSITIONAL (menuType, model,
      // anchor, startIndex, opts); the vault-unlock card is centered (anchor ignored).
      pendingVaultFlow = { wcId, phase: 'unlocking' };
      openOverlayMenu('vault-unlock', [], null, 0);
    }
  });

  // First-run setup cross-renderer triggers (M12 F3 Leg 4 first-run-setup, DD5). The
  // goldfinch://vault page can't call chrome-trust menuOverlay.* directly, so its not-set-up
  // CTA / locked affordance route page → main (internal-vault-request-*) → chrome (here).
  // Mirrors onVaultGesture — a bare trigger, no secret.
  goldfinch.onVaultRequestSetup(() => {
    // Open the master-password setup sheet. On success main drives vault-recovery-show and
    // fires the lock-state broadcast → the page moves to unlocked.
    openOverlayMenu('vault-set', [], null, 0);
  });
  goldfinch.onVaultRequestUnlock(() => {
    // DISTINCT from onVaultGesture's locked branch: open the F2 unlock sheet WITHOUT setting
    // pendingVaultFlow — the page's unlock must NOT spring the fill picker on success (that
    // continuation is gated on pendingVaultFlow.phase === 'unlocking', left null here). The
    // page refreshes off the lock-state broadcast.
    openOverlayMenu('vault-unlock', [], null, 0);
  });
  // Setup-success → open the read-only recovery-show sheet (M12 F3 Leg 4). Main forwards the
  // recovery key ONLY (admin key deferred to F4). Opened DISMISS-DISABLED so a casual
  // dismiss can't lose the unrecoverable one-time key (Escape/backdrop/blur all inert;
  // only acknowledge closes). The key lives only main → chrome → sheet, never in the page.
  goldfinch.onVaultRecoveryShow(({ recoveryKey, replacing }) => {
    // `replacing` (rotate-recovery only; setup omits it) reveals the sheet's "this replaces
    // your previous recovery key" line — the rotation kills the old key (HAT I9). Non-secret.
    openOverlayMenu('vault-recovery-show', { recoveryKey, replacing: replacing === true }, null, 0, { dismissible: false });
  });

  // Access-key mint cross-renderer triggers (M12 F3 Leg 5 access-keys, DD5). The vault page's
  // Mint CTA routes page → main (internal-vault-request-mint carrying the NON-SECRET target) →
  // chrome (here). Open the vault-stepup sheet scoped to that vault; on a successful step-up
  // main drives vault-accesskey-show and the page refreshes its list. Mirrors onVaultRequestSetup
  // (a bare trigger), extended with the target vault id.
  goldfinch.onVaultRequestMint(({ target }) => {
    openOverlayMenu('vault-stepup', { target }, null, 0);
  });
  // Import-bundle cross-renderer trigger (M12 F4 Leg 1 export-import, DD1/DD2; page-modal split M12
  // F5 HAT, I14). The vault page's Import modal picks the destination + bundle file first (page → main
  // internal-vault-pick-import-file: the main-side file open + hold), then on Continue routes page →
  // main (internal-vault-begin-import-unlock) → chrome (here) via the UNCHANGED vault-request-import
  // forward. Open the vault-import-unlock sheet; the destination target + the bundle are held
  // main-side, so the model is an empty array (the sheet collects only the secret + secretKind).
  // On a successful import main closes the sheet + broadcasts lock-state → the page re-renders.
  goldfinch.onVaultRequestImport(() => {
    openOverlayMenu('vault-import-unlock', [], null, 0);
  });
  // Mint-success → open the read-only accesskey-show sheet with the minted { secret, keyId }.
  // Opened DISMISS-DISABLED so a casual dismiss can't lose the unrecoverable one-time secret
  // (Escape/backdrop/blur all inert; only acknowledge closes). The secret lives only
  // main → chrome → sheet, never in the page.
  goldfinch.onVaultAccessKeyShow(({ secret, keyId }) => {
    openOverlayMenu('vault-accesskey-show', { secret, keyId }, null, 0, { dismissible: false });
  });

  // Key-rotation cross-renderer triggers (M12 F4 Leg 2 key-rotation, DD3/DD2). The vault page's
  // rotation-section actions route page → main (internal-vault-request-*) → chrome (here). Recovery
  // rotation REUSES the vault-stepup sheet (mode 'rotate-recovery') for its master-password step-up;
  // on success main mints the new recovery key + drives vault-recovery-show (the setup idiom).
  // Change-master opens the vault-change-master sheet (old + new + confirm). Recover opens the
  // vault-recover sheet (recovery key + new + confirm) — reachable FROM the LOCKED page; on success
  // the store installs the MRK and the page moves to unlocked off the lock-state broadcast. NO secret
  // crosses these bare triggers — every secret + one-time display lives on the chrome-owned sheet.
  goldfinch.onVaultRequestRotateRecovery(() => {
    openOverlayMenu('vault-stepup', { mode: 'rotate-recovery' }, null, 0);
  });
  // Admin-key provision/rotate cross-renderer trigger (M12 F4 Leg 3 admin-key-provision, DD4). The
  // vault page's Provision/rotate admin key action routes page → main (internal-vault-request-rotate-
  // admin) → chrome (here). REUSES the vault-stepup sheet (mode 'rotate-admin') for its master-password
  // step-up; on success main mints the new admin keypair + drives vault-adminkey-show (post-write). NO
  // secret crosses this bare trigger — the master password + the one-time admin key live on the sheet.
  goldfinch.onVaultRequestRotateAdmin(() => {
    openOverlayMenu('vault-stepup', { mode: 'rotate-admin' }, null, 0);
  });
  // Admin-key rotate-success → open the read-only adminkey-show sheet with the minted { adminPrivateKey }.
  // Opened DISMISS-DISABLED so a casual dismiss can't lose the unrecoverable one-time key (Escape/backdrop/
  // blur all inert; only acknowledge closes). The key lives only main → chrome → sheet, never in the page.
  goldfinch.onVaultAdminKeyShow(({ adminPrivateKey }) => {
    openOverlayMenu('vault-adminkey-show', { adminPrivateKey }, null, 0, { dismissible: false });
  });
  goldfinch.onVaultRequestChangeMaster(() => {
    openOverlayMenu('vault-change-master', [], null, 0);
  });
  goldfinch.onVaultRequestRecover(() => {
    openOverlayMenu('vault-recover', [], null, 0);
  });

  // Vault capture offer (M12 F2 Leg 4 capture-save, DD7). Main forwards { captureId,
  // model } after a login-form submit in a set-up, unlocked, persistent-jar tab (model =
  // origin/username/mode/defaultVaultId/choices — NEVER a password; the captured password
  // lives only in the main-side held record). Stash the captureId (the dismiss-drop path
  // reads it in handleClosed), enrich the SAVE choices with jar display labels
  // (Global vs the jar's name), and open the chrome-owned vault-capture sheet. The Save
  // invoke originates in the SHEET (window.menuOverlay.captureSave); chrome only opens it.
  goldfinch.onVaultCaptureOffer(({ captureId, model }) => {
    // Unlock-to-save (locked vault): the credential is held main-side; raise the unlock prompt
    // first and stash the captureId so onVaultLockState finalizes the save/update offer on a
    // successful unlock. pendingCaptureId is set too so an ABANDONED unlock still drops the record.
    if (model && model.mode === 'locked') {
      pendingCaptureId = captureId;
      pendingCaptureUnlock = captureId;
      // keepFocus: this prompt is spawned BY a login-form submit, which also navigates the
      // page; when the submitted page loads it pulls OS focus into the guest. Without the
      // opt-in the sheet's window-blur dismissal tore this prompt down mid-redirect and the
      // held credential was dropped — the operator saw the prompt flash and could never save
      // the password (the same defect the vault-capture sheet fixed for the already-unlocked
      // branch of this very flow). The flag makes the card survive that incidental blur AND
      // makes main re-grab focus for it, so the master password cannot be typed into the
      // page's own fields. Every deliberate decline (Escape / Cancel / X / backdrop / a real
      // app-switch) still closes it and still drops the held credential via handleClosed.
      openOverlayMenu('vault-unlock', [], null, 0, { keepFocus: true });
      return;
    }
    openCaptureSheet(captureId, model);
  });

  // Subscribe FIRST, then fetch the initial state — so a transition that fires
  // between subscribe and fetch is not lost, and a fresher push always wins over a
  // late init fetch (DD10 freshness contract).
  goldfinch.onVaultLockState((/** @type {{ setUp: boolean, unlocked: boolean }} */ state) => {
    vaultStatePushed = true;
    lockState = state;
    renderVaultIndicator(state);
    // Continue a mid-unlock flow ONLY when we are the tab that raised the unlock
    // prompt (phase === 'unlocking') and the store is now unlocked — the phase guard
    // stops an unrelated later unlock (recovery/admin, or another tab) from springing
    // the picker on a stale tab.
    if (pendingVaultFlow && pendingVaultFlow.phase === 'unlocking' && state.unlocked) {
      pendingVaultFlow.phase = 'picking';
      openVaultPicker(pendingVaultFlow.wcId);
    }
    // Unlock-to-save continuation: a login-form submit into a LOCKED vault held the credential
    // and raised this unlock prompt; on success finalize the save/update offer and open the
    // capture sheet. Cleared here so an unrelated later unlock can't re-fire it. A null model
    // (record timed out / tab re-jarred) simply shows nothing.
    if (pendingCaptureUnlock && state.unlocked) {
      const captureId = pendingCaptureUnlock;
      pendingCaptureUnlock = null;
      Promise.resolve(goldfinch.vaultCaptureFinalize(captureId))
        .then((/** @type {any} */ offer) => {
          if (offer && offer.model) { openCaptureSheet(offer.captureId, offer.model); return; }
          // No sheet to open — SAY SO. The operator typed their master password expressly to
          // save this password; the pre-existing silent return made a correct no-op ("already
          // saved") indistinguishable from a dropped credential, which is how a real failure
          // went undiagnosed. Reason-distinct copy, the bookmark-edit rejection precedent.
          reportNoCaptureOffer(offer && offer.reason);
        })
        .catch(() => reportNoCaptureOffer('error'));
    }
  });
  goldfinch.getVaultLockState()
    .then((/** @type {{ setUp: boolean, unlocked: boolean }} */ state) => { lockState = state; if (!vaultStatePushed) renderVaultIndicator(state); })
    .catch(() => {});

  // The 11 vault sheet overlay-menu states (the `downloads:` single-entry precedent
  // generalized to a spread — none of these eleven sheets has a chrome trigger element,
  // so none has an aria-expanded target or trigger refocus; the guest, or nothing, owns
  // focus on close). Comments below narrate WHY each sheet has no trigger.
  const overlayStates = {
    // Human vault flow sheets (M12 F2 Leg 3 pick-and-fill, DD5/DD6). Both are raised
    // from a guest lock-icon gesture — there is no chrome trigger element, so there is
    // no aria-expanded target and no trigger refocus (the guest owns focus). The
    // chrome-unlock leg added the vault-unlock TEMPLATE + secret handler; the pick-and-
    // fill leg wired its trigger→open here alongside the new picker.
    'vault-unlock': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-picker': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Vault capture save/update sheet (M12 F2 Leg 4 capture-save, DD7). Raised from a
    // main-forwarded login-submit offer — no chrome trigger element, so no aria-expanded
    // target and no trigger refocus (the guest owns focus). handleClosed drops the
    // held record on a non-save close.
    'vault-capture': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // First-run setup sheets (M12 F3 Leg 4 first-run-setup, DD5). Both are raised from the
    // goldfinch://vault page's cross-renderer request path (page → main → chrome) — there is
    // no chrome trigger element, so no aria-expanded target and no trigger refocus. vault-set
    // is the master-password entry; vault-recovery-show is the DISMISS-DISABLED one-time key
    // display (opened with { dismissible: false }).
    'vault-set': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-recovery-show': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Access-key sheets (M12 F3 Leg 5 access-keys, DD5). Both are raised from the
    // goldfinch://vault page's cross-renderer request/response path (page → main → chrome) —
    // no chrome trigger element, so no aria-expanded target and no trigger refocus. vault-stepup
    // is the master-password re-auth; vault-accesskey-show is the DISMISS-DISABLED one-time
    // minted-secret display (opened with { dismissible: false }).
    'vault-stepup': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-accesskey-show': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Import-bundle secret entry (M12 F4 Leg 1 export-import, DD1/DD2). Raised from the
    // goldfinch://vault page's cross-renderer import request (page → main → chrome) after the
    // main-side file open — no chrome trigger element, so no aria-expanded target and no trigger
    // refocus. The destination target + the bundle are held main-side; the sheet collects only the
    // secret + secretKind over the dedicated Buffer channel.
    'vault-import-unlock': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Key-rotation sheets (M12 F4 Leg 2 key-rotation, DD3/DD2). All raised from the
    // goldfinch://vault page's cross-renderer request path (page → main → chrome) — no chrome
    // trigger element, so no aria-expanded target and no trigger refocus. vault-change-master is
    // the old + new master-password entry; vault-recover is the recovery-key + new-master entry
    // (reachable from the LOCKED page). Recovery rotation's master-password step-up REUSES the
    // vault-stepup sheet above (mode 'rotate-recovery'), so it needs no entry of its own.
    'vault-change-master': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-recover': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Admin-key provision/rotate display (M12 F4 Leg 3 admin-key-provision, DD4). Raised from the
    // goldfinch://vault page's cross-renderer request/response path (page → main → chrome) — no chrome
    // trigger element, so no aria-expanded target and no trigger refocus. vault-adminkey-show is the
    // DISMISS-DISABLED one-time admin-private-key display (opened with { dismissible: false }); the
    // master-password step-up REUSES the vault-stepup sheet (mode 'rotate-admin'), so it needs no entry.
    'vault-adminkey-show': {
      open: false, token: 0, blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    }
  };

  // Channel-6 activation dispatch for the vault-owned menuTypes (the `downloads:`
  // `handleActivation` precedent, chained ahead of `dispatchOverlayActivation` in
  // renderer.js). Returns `true` (handled) for vault-picker's real dispatch and for
  // the three DISMISS-DISABLED show/ack sheets' validated no-op (their only ever
  // activation is id:'ack', already consumed by main closing the sheet); `false` for
  // every non-vault menuType and for the vault menuTypes with no channel-4 activation
  // at all (vault-unlock, vault-set, vault-capture, vault-stepup, vault-import-unlock,
  // vault-change-master, vault-recover) — those fall through exactly as they did when
  // `dispatchOverlayActivation`'s switch had no case for them (unchanged behavior).
  /** @param {{ menuType: string, id: string, value?: string }} payload */
  function handleActivation(payload) {
    if (!payload || typeof payload.menuType !== 'string') return false;
    const { menuType, id } = payload;
    if (menuType === 'vault-picker') {
      // Human fill selection (M12 F2 Leg 3, DD5/DD6). The id is `pick:<i>` — an
      // INDEX into the last picker model (metadata only; NO password on this path).
      // Resolve the row, capture the flow's wcId, then dispatch the fill in MAIN
      // (vaultFillHuman resolves the credential by (vaultId, itemId) under the MRK
      // and hands it to F1's channel — the return carries no password). On a lock
      // between pick and fill (`reason:'locked'`), re-raise the unlock prompt →
      // onVaultLockState re-opens the picker (re-pick), rather than erroring.
      //
      // The separated "Manage passwords" footer is not a row: it navigates to the
      // Secrets page (openVaultPage — a trusted goldfinch://vault tab). No secret, no
      // fill; clear any pending flow so a later gesture starts clean.
      if (id === MANAGE_ID) {
        pendingVaultFlow = null;
        openVaultPage();
        return true;
      }
      const idx = parsePickIndex(id);
      const item = idx != null ? lastPickerModel[idx] : null;
      const wcId = pendingVaultFlow ? pendingVaultFlow.wcId : null;
      pendingVaultFlow = null;
      if (!item || wcId == null) return true;
      Promise.resolve(goldfinch.vaultFillHuman({ wcId, vaultId: item.vaultId, itemId: item.id }))
        .then((/** @type {any} */ r) => {
          if (r && r.reason === 'locked') {
            pendingVaultFlow = { wcId, phase: 'unlocking' };
            openOverlayMenu('vault-unlock', [], null, 0);
          }
        })
        .catch(() => {});
      return true;
    }
    if (menuType === 'vault-recovery-show') {
      // First-run recovery-key acknowledge (M12 F3 Leg 4). The only activation is
      // id:'ack' — the deliberate "I've saved it". Main already closed the sheet and the
      // vault page already moved to unlocked off the setup lock-state broadcast, so there
      // is nothing more to do here (no secret ever reaches this dispatch — the key lived
      // only on the sheet).
      return true;
    }
    if (menuType === 'vault-accesskey-show') {
      // Minted access-key acknowledge (M12 F3 Leg 5). The only activation is id:'ack' — the
      // deliberate "I've saved it". Main already closed the sheet; the vault page refreshes
      // its access-key list off its own post-mint path. Nothing reaches this dispatch (the
      // minted secret lived only on the sheet — never in the page or this dispatch).
      return true;
    }
    if (menuType === 'vault-adminkey-show') {
      // Minted admin-key acknowledge (M12 F4 Leg 3). The only activation is id:'ack' — the
      // deliberate "I've saved it". Main already closed the sheet; nothing reaches this dispatch
      // (the admin private key lived only on the sheet — never in the page or this dispatch).
      return true;
    }
    return false;
  }

  // Channel-7 close-state sink for the vault menuTypes (moved wholesale from
  // renderer.js's handleOverlayClosed — the `lockState`-gated guards are unchanged;
  // `lockState` and both guards moved together into this module, so the gating logic
  // itself was never touched, only relocated).
  /** @param {{ menuType: string, reason: string }} args */
  function handleClosed({ menuType, reason }) {
    // Human vault flow (M12 F2 Leg 3): the user dismissed the unlock prompt (Cancel/
    // Escape/outside-click) without unlocking — abandon the flow so a later unrelated
    // unlock (recovery/admin, or another tab) can't spring the picker on this stale
    // tab. Guarded on the phase + still-locked state: a SUCCESSFUL unlock closes this
    // sheet too, but by then onVaultLockState has advanced the phase to 'picking' and
    // lockState.unlocked is true, so this clear is correctly skipped.
    if (menuType === 'vault-unlock'
      && pendingVaultFlow && pendingVaultFlow.phase === 'unlocking'
      && !lockState.unlocked) {
      pendingVaultFlow = null;
    }
    // Unlock-to-save abandoned: the unlock prompt raised for a locked-vault capture was
    // dismissed WITHOUT unlocking (Cancel/Escape/outside-click) → drop the held credential now
    // rather than waiting for the 2-min safety timeout. On a SUCCESSFUL unlock, onVaultLockState
    // already cleared pendingCaptureUnlock (and lockState.unlocked is true), so this is skipped.
    //
    // NO 'superseded' carve-out here, unlike the vault-capture branch below — deliberately,
    // and the asymmetry is only apparent. A NEWER capture's unlock prompt is the SAME
    // menuType, so `open()` bumps this menuType's chrome-side token BEFORE main emits the
    // superseded channel 7 for the OLD one, and overlay-menus.js drops that stale-token close
    // without ever reaching here — the case the sibling guard protects against cannot arrive.
    // What DOES arrive is a supersede by an UNRELATED menu (kebab, suggestions), where
    // pendingCaptureUnlock still names THIS capture, the prompt is gone, and dropping the held
    // password promptly is the conservative answer.
    if (menuType === 'vault-unlock' && pendingCaptureUnlock && !lockState.unlocked) {
      const captureId = pendingCaptureUnlock;
      pendingCaptureUnlock = null;
      pendingCaptureId = null;
      Promise.resolve(goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
    }
    // Human vault capture (M12 F2 Leg 4, DD7 — the dismiss-drop path, HIGH): the
    // save/update sheet closed. Tell main to drop+zeroize the held record NOW (not just
    // on the 2-min timeout) UNLESS this was a save. 'activated' = a successful save (main
    // already dropped the record). 'superseded' = a newer capture model-replaced this
    // sheet: main's capture() already evicted the prior record, and pendingCaptureId now
    // names the NEW capture — dismissing it would wrongly drop the live one, so skip the
    // whole block (leaving pendingCaptureId intact for the new offer).
    if (menuType === 'vault-capture' && reason !== 'superseded') {
      const captureId = pendingCaptureId;
      pendingCaptureId = null;
      if (captureId != null && reason !== 'activated') {
        Promise.resolve(goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
      }
    }
  }

  // M12 F3 Leg 4 (first-run-setup, DD5/DD9): a11y SHEET_STATES hooks for the two new setup
  // sheets (scripts/a11y-audit.mjs). vault-set opens empty; vault-recovery-show opens with a
  // synthetic NON-SECRET placeholder key so its read-only display + Copy + acknowledge
  // render (opened dismiss-disabled, so the audit acknowledges rather than Escapes it).
  // FD-authorized seam additions per the leg's "add both to SHEET_STATES" deliverable — the
  // M09 F5 openTabContextMenuForAudit precedent.
  const openVaultSetOverlayForAudit = () => openOverlayMenu('vault-set', [], null, 0);
  const openVaultRecoveryShowOverlayForAudit = () =>
    openOverlayMenu('vault-recovery-show', { recoveryKey: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' }, null, 0, { dismissible: false });
  // M12 F3 Leg 5 (access-keys, DD5/DD9): a11y SHEET_STATES hooks for the two new access-key
  // sheets. vault-stepup opens with a synthetic NON-SECRET target; vault-accesskey-show opens
  // with a synthetic NON-SECRET placeholder secret+keyId so its read-only display + Copy +
  // acknowledge render (opened dismiss-disabled, so the audit acknowledges rather than Escapes
  // it). Same evaluate-seam precedent as leg 4's openVault{Set,RecoveryShow}OverlayForAudit.
  const openVaultStepupOverlayForAudit = () => openOverlayMenu('vault-stepup', { target: 'global' }, null, 0);
  const openVaultAccessKeyShowOverlayForAudit = () =>
    openOverlayMenu('vault-accesskey-show', { secret: 'ACCESS-SECRET-PLACEHOLDER', keyId: 'KEYID-PLACEHOLDER' }, null, 0, { dismissible: false });
  // M12 F4 Leg 1 (export-import, DD9): a11y SHEET_STATES hook for the vault-import-unlock sheet.
  // Opens with an empty array model (the destination target + bundle are held main-side); the sheet
  // renders the secretKind radios + the secret field + Import/Cancel (dialog-style, Escape-dismissible).
  const openVaultImportUnlockOverlayForAudit = () => openOverlayMenu('vault-import-unlock', [], null, 0);
  // M12 F4 Leg 2 (key-rotation, DD9): a11y SHEET_STATES hooks for the two new rotation sheets. Both
  // open with an empty array model (no secret; the destination is the manager itself); each renders
  // its three password fields + error + submit/cancel (dialog-style, Escape-dismissible). Recovery
  // rotation's step-up reuses vault-stepup, already covered above. Same evaluate-seam precedent as
  // the leg-1 openVaultImportUnlockOverlayForAudit.
  const openVaultChangeMasterOverlayForAudit = () => openOverlayMenu('vault-change-master', [], null, 0);
  const openVaultRecoverOverlayForAudit = () => openOverlayMenu('vault-recover', [], null, 0);
  // M12 F4 Leg 3 (admin-key-provision, DD4/DD9): a11y SHEET_STATES hook for the vault-adminkey-show
  // sheet. Opens with a synthetic NON-SECRET placeholder key so its read-only display + Copy +
  // acknowledge render (opened dismiss-disabled, so the audit acknowledges rather than Escapes it).
  // Same evaluate-seam precedent as leg-5's openVaultAccessKeyShowOverlayForAudit.
  const openVaultAdminKeyShowOverlayForAudit = () =>
    openOverlayMenu('vault-adminkey-show', { adminPrivateKey: 'ADMIN-PRIVATE-KEY-PLACEHOLDER' }, null, 0, { dismissible: false });

  return {
    overlayStates,
    handleActivation,
    handleClosed,
    openVaultSetOverlayForAudit,
    openVaultRecoveryShowOverlayForAudit,
    openVaultStepupOverlayForAudit,
    openVaultAccessKeyShowOverlayForAudit,
    openVaultImportUnlockOverlayForAudit,
    openVaultChangeMasterOverlayForAudit,
    openVaultRecoverOverlayForAudit,
    openVaultAdminKeyShowOverlayForAudit
  };
}
