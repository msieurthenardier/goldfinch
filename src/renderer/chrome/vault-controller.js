// @ts-check

import { buildVaultIndicatorModel } from '../../shared/vault-indicator-model.js';
import { parsePickIndex, MANAGE_ID } from '../../shared/vault-picker-template.js';

// Close-reason classification for the vault-capture presentation queue's `advance()`
// gate (M21 F3 L2, AC5c). Mirrors the resolution-vs-occlusion vocabulary
// `src/main/auth-challenges.js` already documents and unit-pins (that module cannot be
// imported here — it is a main-process, Electron-requiring module, and this is
// chrome-renderer code) rather than inventing a new one: OCCLUSION means the sheet was
// merely HIDDEN — the operator might refocus, switch back, or the trigger might
// re-present later — never that anything was resolved, so a queued next offer must
// never pop open on an unfocused window or over a different tab. Anything NOT in this
// set is resolution-class (the SAME fail-safe-to-resolution default auth-challenges.js
// documents: an unrecognized future reason must still let a legitimate presentation
// continue rather than silently wedging) — escape / outside-click / activated /
// tab-close / teardown all advance normally.
const OCCLUSION_CLOSE_REASONS = new Set(['blur', 'superseded', 'tab-hide', 'tab-switch']);

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
 * NOT owned here (M14 F1 auth/cert challenge flow — adjacent but distinct; owned
 * by auth-challenge-controller.js, extracted M21 F3 Leg 1): onAuthChallengePresent
 * / onCertChallengePresent, their overlay states, no-op dispatch cases, and audit
 * hooks.
 *
 * @param {{
 *   els: Record<string, any>,
 *   goldfinch: any,
 *   jarsClient: any,
 *   isSafeColor: (color: any) => boolean,
 *   openVaultPage: () => void,
 *   openOverlayMenu: (menuType: string, model: any, anchor: any, startIndex?: number, opts?: any) => boolean,
 *   openToolbarContextMenu?: (item: 'media'|'shields'|'devtools'|'vault', anchorEl: any) => void,
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
  // Toolbar-mode page-context sheet opener (squawk 0038 — the same closure
  // media/privacy/devtools controllers receive for their pin buttons' right-click
  // "Unpin …" menu; CLAUDE.md's Toolbar-pins pattern). Optional so an offline unit
  // harness constructs without it; the no-op then simply never opens the sheet.
  openToolbarContextMenu = () => {},
  // Chrome toast surface (the bookmarks-client `toast` precedent). Optional so an
  // offline unit harness constructs without one; the no-op then simply says nothing.
  toast = () => {}
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
   * it when the vault-capture sheet closes without a save. Stays a SCALAR (M21 F3 L2,
   * AC9): serial presentation (below) means at most one vault-capture sheet is ever
   * open at a time, so there is never more than one "currently showing" captureId to
   * track. */
  let pendingCaptureId = null;
  /** @type {boolean} whether a vault-capture sheet is CURRENTLY open (M21 F3 L2, AC5b) —
   * the single guard that makes `advance()` idempotent/self-guarding across its three
   * callers: extra calls while a sheet is already open are harmless no-ops. */
  let sheetOpen = false;
  /** @type {Array<{ captureId: string, model: any }>} the PRESENTATION queue (M21 F3 L2,
   * DD1) of already-resolved offers waiting their turn — offers arriving while a
   * vault-capture sheet is open queue here instead of model-replacing it; `advance()` is
   * the ONLY place one is shifted off and shown. */
  let presentationQueue = [];
  /** @type {string[]} the LOCKED-mode pending-unlock queue (M21 F3 L2, DD1's amendment) —
   * every captureId released while the vault was locked, awaiting a single unlock-to-save
   * drain. `advance()` finalizes one at a time (via `vaultCaptureFinalize`) once the
   * presentation queue is empty; a successful finalize is pushed onto `presentationQueue`
   * and travels the SAME path as any other offer — this is not a second advance point.
   * Drained wholesale (not just the head) on an abandoned unlock (AC8). */
  let pendingCaptureUnlock = [];
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
    sheetOpen = true;
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
      locked: ['Password not saved', 'The vault is locked.']
    }[String(reason)] || ['Password not saved', 'The saved-password prompt could not be opened.'];
    toast(copy[0], copy[1]);
  }

  // Drop EVERY queued captureId (M21 F3 L2, LD2/AC5d) — both the already-resolved
  // presentation queue and any still-locked entries awaiting their turn at the
  // unlock-to-save drain. Used when the currently-open vault-capture sheet closes for
  // an OCCLUSION-class reason (AC5c): nothing will ever call `advance()` again for
  // THIS window until some unrelated future event, so leaving a sibling queued would
  // orphan it — LD2's "no orphaned queue entry nothing will ever advance" applies
  // equally to a not-yet-finalized locked entry as to an already-resolved one. The
  // record the sheet WAS showing is dismissed by the caller before this runs; this
  // drains only the siblings.
  function dismissQueuedOffers() {
    const captureIds = presentationQueue.map((o) => o.captureId).concat(pendingCaptureUnlock);
    presentationQueue = [];
    pendingCaptureUnlock = [];
    for (const captureId of captureIds) {
      Promise.resolve(goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
    }
  }

  // The ONE place a vault-capture sheet is opened from a queue (M21 F3 L2, AC5/AC5b).
  // IDEMPOTENT and SELF-GUARDING via the `sheetOpen` flag — every one of its three
  // callers (handleClosed's vault-capture branch on a resolution-class reason;
  // onVaultLockState's unlock-success continuation, which STARTS the locked drain;
  // onVaultCaptureOffer's already-unlocked branch, which opens immediately when idle)
  // can call it freely; a call while a sheet is already open is a harmless no-op.
  // Order: the presentation queue first; if it is empty and a locked drain remains,
  // finalize the NEXT locked entry and recurse — a successful finalize is pushed onto
  // the SAME presentation queue and travels the same path as any other offer (the two
  // arrays are not two advance points; only the UNFINALIZED locked half is separate).
  function advance() {
    if (sheetOpen) return;
    if (presentationQueue.length > 0) {
      const next = presentationQueue.shift();
      openCaptureSheet(next.captureId, next.model);
      return;
    }
    if (pendingCaptureUnlock.length === 0) return;
    const captureId = pendingCaptureUnlock.shift();
    Promise.resolve(goldfinch.vaultCaptureFinalize(captureId))
      .then((/** @type {any} */ offer) => {
        if (offer && offer.model) {
          presentationQueue.push({ captureId: offer.captureId, model: offer.model });
        } else {
          reportNoCaptureOffer(offer && offer.reason);
        }
        advance(); // drains the rest of the locked queue regardless of this entry's outcome
      })
      .catch(() => {
        reportNoCaptureOffer('error');
        advance();
      });
  }

  /** @param {{ setUp: boolean, unlocked: boolean }} state */
  function renderVaultIndicator(state) {
    const el = els.vaultIndicator;
    if (!el) return;
    const model = buildVaultIndicatorModel(state);
    el.classList.toggle('hidden', !model.visible);
    el.classList.toggle('vault-locked', model.visible && model.state === 'locked');
    el.classList.toggle('vault-unlocked', model.visible && model.state === 'unlocked');
    const label = model.visible && model.state === 'unlocked' ? 'Password manager unlocked' : 'Password manager locked';
    el.setAttribute('aria-label', label);
  }

  /** Whether the vault is currently locked (squawk 0038's "Lock now" context-menu item
   * omit gate) — reads the stashed `lockState` (DD10 freshness contract: a pure
   * projection of the pushed vault-lock-state, never re-fetched). Also true before the
   * manager is set up; the indicator itself is hidden then (unreachable in practice). */
  function isVaultLocked() {
    return !lockState.unlocked;
  }

  /** The vault indicator's context-menu "Lock now" action: the SAME explicit
   * vault-lock path the goldfinch://vault page's inline "Lock now" button drives
   * (`bridge.lockVault()` there → `internal-vault-lock`; `goldfinch.vaultLock()` here →
   * `vault-lock` — both bare `ipcMain.handle`s over the shared main-side `vaultLockNow()`,
   * idempotent + global, Mission 12). No local state mutation: the store's `onLock` hook
   * already fires the `vault-lock-state` broadcast that re-renders the indicator. */
  function lockNow() {
    Promise.resolve(goldfinch.vaultLock()).catch(() => {});
  }

  // Right-click → the shared toolbar-mode page-context sheet (squawk 0038, GitHub #113
  // "Lock now" half — the pinnable half is DECLINED by operator ruling: the indicator
  // stays put and is NEVER added to toolbarPins/UNPIN_LABELS). Same wiring shape as the
  // media/shields/devtools pin buttons' own contextmenu listeners (CLAUDE.md's Toolbar-
  // pins pattern); the model omits "Lock now" when already locked (page-context-model.js,
  // opts.vaultLocked below). Guarded on `els.vaultIndicator` for the offline harnesses
  // that construct with `els: { vaultIndicator: null }` (no DOM).
  if (els.vaultIndicator) {
    els.vaultIndicator.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openToolbarContextMenu('vault', els.vaultIndicator);
    });
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
    openOverlayMenu('vault-recovery-show', { recoveryKey, replacing: replacing === true }, null, 0, {
      dismissible: false
    });
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
  // Compromise-mode rotation trigger (M18 F2 L4, flight DD4). The vault page's confirm
  // modal Continue routes page → main (internal-vault-request-compromise) → chrome (here).
  // Opens the MASTER branch; the sheet's own "Use your recovery key instead" switch
  // reopens the recovery branch via the handleActivation case below (close-then-reopen —
  // design-review M1). Reachable from BOTH lock states (R4: the sheet doubles as unlock).
  // NO secret crosses this bare trigger. The compromise sheets can never be requested
  // while a vault-recovery-show is live (Q2: the dismiss-locked sheet blocks the page,
  // so the page's Continue is unreachable underneath it).
  goldfinch.onVaultRequestCompromise(() => {
    openOverlayMenu('vault-compromise', [], null, 0);
  });

  // Vault capture offer (M12 F2 Leg 4 capture-save, DD7; multi-hold M21 F3 L2, DD1's
  // amendment). Main forwards { captureId, model } after a login-form OR card-form
  // submit in a set-up, unlocked, persistent-jar tab (model =
  // origin/username/mode/defaultVaultId/choices — NEVER a password; the captured secret
  // lives only in the main-side held record). A settle can now release MULTIPLE
  // families for one tab, so main pushes ONE offer per family; each push arrives here
  // as its own call.
  goldfinch.onVaultCaptureOffer(({ captureId, model }) => {
    // Unlock-to-save (locked vault): the credential is held main-side; raise the unlock
    // prompt first, ONCE PER DRAIN (AC7) — only the FIRST locked offer of an otherwise-
    // empty drain opens it; every later one just appends to `pendingCaptureUnlock` and
    // waits its turn (onVaultLockState's continuation / advance() drains the array
    // serially). An abandoned unlock drops EVERY queued captureId (AC8), read directly
    // off this array — see handleClosed's vault-unlock branch below.
    if (model && model.mode === 'locked') {
      const firstOfDrain = pendingCaptureUnlock.length === 0;
      pendingCaptureUnlock.push(captureId);
      if (firstOfDrain) {
        // keepFocus: this prompt is spawned BY a login/card-form submit, which also
        // navigates the page; when the submitted page loads it pulls OS focus into the
        // guest. Without the opt-in the sheet's window-blur dismissal tore this prompt
        // down mid-redirect and the held credential was dropped — the operator saw the
        // prompt flash and could never save it (the same defect the vault-capture sheet
        // fixed for the already-unlocked branch of this very flow). The flag makes the
        // card survive that incidental blur AND makes main re-grab focus for it, so the
        // master password cannot be typed into the page's own fields. Every deliberate
        // decline (Escape / Cancel / X / backdrop / a real app-switch) still closes it
        // and still drops every held credential via handleClosed's vault-unlock branch.
        openOverlayMenu('vault-unlock', [], null, 0, { keepFocus: true });
      }
      return;
    }
    // Already unlocked: queue the resolved offer and let advance() present it — never
    // open it directly (AC5, "truly serial, never a model-replace"). advance() no-ops
    // if a vault-capture sheet is already showing a sibling offer.
    presentationQueue.push({ captureId, model });
    advance();
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
    // Unlock-to-save continuation (M21 F3 L2, DD1's amendment): a login/card-form
    // submit into a LOCKED vault held the credential(s) and raised the unlock prompt;
    // on success START THE DRAIN via advance() — it finalizes the queued captureIds
    // ONE AT A TIME (via vaultCaptureFinalize), each resolving into a real offer on
    // the SAME presentation queue as any other, before the next is finalized (AC6).
    // advance() is idempotent/self-guarding (AC5b) — calling it here even when
    // `pendingCaptureUnlock` is empty, or repeatedly across unrelated unlock
    // broadcasts, is a harmless no-op.
    if (pendingCaptureUnlock.length > 0 && state.unlocked) {
      advance();
    }
  });
  goldfinch
    .getVaultLockState()
    .then((/** @type {{ setUp: boolean, unlocked: boolean }} */ state) => {
      lockState = state;
      if (!vaultStatePushed) renderVaultIndicator(state);
    })
    .catch(() => {});

  // The 13 vault sheet overlay-menu states (the `downloads:` single-entry precedent
  // generalized to a spread — none of these thirteen sheets has a chrome trigger element,
  // so none has an aria-expanded target or trigger refocus; the guest, or nothing, owns
  // focus on close). Comments below narrate WHY each sheet has no trigger.
  const overlayStates = {
    // Human vault flow sheets (M12 F2 Leg 3 pick-and-fill, DD5/DD6). Both are raised
    // from a guest lock-icon gesture — there is no chrome trigger element, so there is
    // no aria-expanded target and no trigger refocus (the guest owns focus). The
    // chrome-unlock leg added the vault-unlock TEMPLATE + secret handler; the pick-and-
    // fill leg wired its trigger→open here alongside the new picker.
    'vault-unlock': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-picker': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Vault capture save/update sheet (M12 F2 Leg 4 capture-save, DD7). Raised from a
    // main-forwarded login-submit offer — no chrome trigger element, so no aria-expanded
    // target and no trigger refocus (the guest owns focus). handleClosed drops the
    // held record on a non-save close.
    'vault-capture': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // First-run setup sheets (M12 F3 Leg 4 first-run-setup, DD5). Both are raised from the
    // goldfinch://vault page's cross-renderer request path (page → main → chrome) — there is
    // no chrome trigger element, so no aria-expanded target and no trigger refocus. vault-set
    // is the master-password entry; vault-recovery-show is the DISMISS-DISABLED one-time key
    // display (opened with { dismissible: false }).
    'vault-set': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-recovery-show': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Access-key sheets (M12 F3 Leg 5 access-keys, DD5). Both are raised from the
    // goldfinch://vault page's cross-renderer request/response path (page → main → chrome) —
    // no chrome trigger element, so no aria-expanded target and no trigger refocus. vault-stepup
    // is the master-password re-auth; vault-accesskey-show is the DISMISS-DISABLED one-time
    // minted-secret display (opened with { dismissible: false }).
    'vault-stepup': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-accesskey-show': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Import-bundle secret entry (M12 F4 Leg 1 export-import, DD1/DD2). Raised from the
    // goldfinch://vault page's cross-renderer import request (page → main → chrome) after the
    // main-side file open — no chrome trigger element, so no aria-expanded target and no trigger
    // refocus. The destination target + the bundle are held main-side; the sheet collects only the
    // secret + secretKind over the dedicated Buffer channel.
    'vault-import-unlock': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
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
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-recover': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Compromise-mode rotation sheets (M18 F2 L4, flight DD4). Both raised from the
    // goldfinch://vault page's cross-renderer request path (page → main → chrome) — no
    // chrome trigger element, so no aria-expanded target and no trigger refocus.
    // vault-compromise is the master-branch credential entry (current + new + confirm +
    // the recovery switch); vault-compromise-recover is the recovery branch (recovery
    // key + new + confirm), reopened via handleActivation's 'use-recovery' case.
    'vault-compromise': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    'vault-compromise-recover': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    },
    // Admin-key provision/rotate display (M12 F4 Leg 3 admin-key-provision, DD4). Raised from the
    // goldfinch://vault page's cross-renderer request/response path (page → main → chrome) — no chrome
    // trigger element, so no aria-expanded target and no trigger refocus. vault-adminkey-show is the
    // DISMISS-DISABLED one-time admin-private-key display (opened with { dismissible: false }); the
    // master-password step-up REUSES the vault-stepup sheet (mode 'rotate-admin'), so it needs no entry.
    'vault-adminkey-show': {
      open: false,
      token: 0,
      blurClosedAt: -Infinity,
      ariaTarget: () => null,
      refocus() {}
    }
  };

  // Channel-6 activation dispatch for the vault-owned menuTypes (the `downloads:`
  // `handleActivation` precedent, chained ahead of `dispatchOverlayActivation` in
  // renderer.js). Returns `true` (handled) for vault-picker's real dispatch, for
  // vault-compromise's recovery-branch switch (M18 F2 L4 — the close-then-reopen), and
  // for the three DISMISS-DISABLED show/ack sheets' validated no-op (their only ever
  // activation is id:'ack', already consumed by main closing the sheet); `false` for
  // every non-vault menuType and for the vault menuTypes with no channel-4 activation
  // at all (vault-unlock, vault-set, vault-capture, vault-stepup, vault-import-unlock,
  // vault-change-master, vault-recover, vault-compromise-recover) — those fall through
  // exactly as they did when `dispatchOverlayActivation`'s switch had no case for them
  // (unchanged behavior).
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
    if (menuType === 'vault-compromise') {
      // Compromise-mode recovery-branch switch (M18 F2 L4, design-review M1). The
      // master-branch sheet's "Use your recovery key instead" sent id:'use-recovery';
      // main has ALREADY closed the compromise sheet ('activated') by the time this
      // forward arrives, so re-opening here is a clean open, never a model replace
      // ('superseded' closes even dismiss-locked sheets — the F17-4 clobber lesson).
      // No secret rides this path — both credential entries live on the sheets.
      if (id === 'use-recovery') {
        openOverlayMenu('vault-compromise-recover', [], null, 0);
      }
      return true;
    }
    if (menuType === 'vault-recovery-show') {
      // First-run recovery-key acknowledge (M12 F3 Leg 4). The only activation is
      // id:'ack' — the deliberate "I've saved it". Main already closed the sheet and the
      // vault page already moved to unlocked off the setup lock-state broadcast, so there
      // is nothing more to do here (no secret ever reaches this dispatch — the key lived
      // only on the sheet). For a COMPROMISE reveal's ack (M18 F2 L4), main's activated
      // handler already consumed the per-window marker, released the suppression hold,
      // and re-broadcast vault-lock-state — same nothing-more-to-do here.
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
    if (
      menuType === 'vault-unlock' &&
      pendingVaultFlow &&
      pendingVaultFlow.phase === 'unlocking' &&
      !lockState.unlocked
    ) {
      pendingVaultFlow = null;
    }
    // Unlock-to-save abandoned (M21 F3 L2, AC8): the unlock prompt raised for a
    // locked-vault capture was dismissed WITHOUT unlocking (Cancel/Escape/outside-click)
    // → drop EVERY queued held credential now, not just the one that opened the prompt
    // — rather than waiting for the 2-min safety timeout. On a SUCCESSFUL unlock,
    // `advance()` drains `pendingCaptureUnlock` progressively (and lockState.unlocked
    // is true), so this is correctly skipped.
    //
    // NO 'superseded' carve-out here, unlike the vault-capture branch below — deliberately,
    // and the asymmetry is only apparent. A NEWER capture's unlock prompt is the SAME
    // menuType, so `open()` bumps this menuType's chrome-side token BEFORE main emits the
    // superseded channel 7 for the OLD one, and overlay-menus.js drops that stale-token close
    // without ever reaching here — the case the sibling guard protects against cannot arrive.
    // What DOES arrive is a supersede by an UNRELATED menu (kebab, suggestions), where
    // pendingCaptureUnlock still names these captures, the prompt is gone, and dropping the
    // held secrets promptly is the conservative answer.
    if (menuType === 'vault-unlock' && pendingCaptureUnlock.length > 0 && !lockState.unlocked) {
      const captureIds = pendingCaptureUnlock;
      pendingCaptureUnlock = [];
      pendingCaptureId = null;
      for (const captureId of captureIds) {
        Promise.resolve(goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
      }
    }
    // Human vault capture (M12 F2 Leg 4, DD7 — the dismiss-drop path, HIGH; serial
    // presentation M21 F3 L2, AC5/AC5c/AC5d/AC9): the save/update sheet closed. Tell
    // main to drop+zeroize the held record NOW (not just on the 2-min timeout) UNLESS
    // this was a save. 'activated' = a successful save (main already dropped the
    // record).
    //
    // NO 'superseded' carve-out here (fixed post-landing — the leg's own Notes flagged
    // this as a latent gap, and the Flight Director overruled deferring it: `sheetOpen`
    // is state THIS leg introduced, so its lifecycle bug is this leg's to fix). The
    // pre-fix reasoning assumed a same-family "newer capture model-replaced this sheet"
    // case could still reach here — it cannot, under this leg's OWN serial design:
    // `openCaptureSheet` has exactly one caller (`advance()`, above), and `advance()`
    // returns immediately whenever `sheetOpen` is true — so a vault-capture sheet can
    // never model-replace another vault-capture sheet; a same-family resubmit now
    // QUEUES behind the open sheet instead of ever calling `openMenu` against it.
    // Therefore a 'superseded' close of `vault-capture` can only mean an UNRELATED menu
    // (kebab, suggestions, page-context, …) took over — exactly the case
    // `OCCLUSION_CLOSE_REASONS` already lists 'superseded' for, mirroring
    // `auth-challenges.js`'s own occlusion bucket. Routing it through the SAME
    // occlusion path as 'blur' below closes the bug the old carve-out caused: a stuck
    // `sheetOpen === true` that permanently refused every future `advance()` call for
    // the window, plus an abandoned held record left alive until the 2-minute TTL
    // instead of dismissed promptly.
    if (menuType === 'vault-capture') {
      const captureId = pendingCaptureId;
      pendingCaptureId = null;
      sheetOpen = false;
      if (captureId != null && reason !== 'activated') {
        Promise.resolve(goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
      }
      if (OCCLUSION_CLOSE_REASONS.has(reason)) {
        // LD2: an occlusion-class close (blur / superseded / tab-hide / tab-switch)
        // drops the WHOLE remaining queue, matching what already happens to the offer
        // that WAS showing (dismissed just above) — leaving a queued sibling behind
        // would orphan it, since nothing will call advance() again for an occluded
        // (or superseded-by-an-unrelated-menu) window. Deliberately does NOT call
        // advance() here — doing so would re-open a vault-capture sheet on top of the
        // menu the operator just opened.
        dismissQueuedOffers();
      } else {
        // AC5c: resolution-class only (escape / outside-click / activated / tab-close /
        // teardown) — present the next queued offer, if any.
        advance();
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
    openOverlayMenu('vault-recovery-show', { recoveryKey: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' }, null, 0, {
      dismissible: false
    });
  // M12 F3 Leg 5 (access-keys, DD5/DD9): a11y SHEET_STATES hooks for the two new access-key
  // sheets. vault-stepup opens with a synthetic NON-SECRET target; vault-accesskey-show opens
  // with a synthetic NON-SECRET placeholder secret+keyId so its read-only display + Copy +
  // acknowledge render (opened dismiss-disabled, so the audit acknowledges rather than Escapes
  // it). Same evaluate-seam precedent as leg 4's openVault{Set,RecoveryShow}OverlayForAudit.
  const openVaultStepupOverlayForAudit = () => openOverlayMenu('vault-stepup', { target: 'global' }, null, 0);
  const openVaultAccessKeyShowOverlayForAudit = () =>
    openOverlayMenu(
      'vault-accesskey-show',
      { secret: 'ACCESS-SECRET-PLACEHOLDER', keyId: 'KEYID-PLACEHOLDER' },
      null,
      0,
      { dismissible: false }
    );
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
    openOverlayMenu('vault-adminkey-show', { adminPrivateKey: 'ADMIN-PRIVATE-KEY-PLACEHOLDER' }, null, 0, {
      dismissible: false
    });
  // M18 F2 L4 (compromise-mode rotation, DD4/DD9): a11y SHEET_STATES hooks for the two
  // compromise sheets. Both open with an empty array model (no secret; the destination is
  // the manager itself); each renders its three password fields + error + pending +
  // danger submit/cancel (dialog-style, Escape-dismissible; the master branch adds the
  // recovery switch link). Same evaluate-seam precedent as openVaultChangeMasterOverlayForAudit.
  const openVaultCompromiseOverlayForAudit = () => openOverlayMenu('vault-compromise', [], null, 0);
  const openVaultCompromiseRecoverOverlayForAudit = () => openOverlayMenu('vault-compromise-recover', [], null, 0);

  return {
    overlayStates,
    handleActivation,
    handleClosed,
    isVaultLocked,
    lockNow,
    openVaultSetOverlayForAudit,
    openVaultRecoveryShowOverlayForAudit,
    openVaultStepupOverlayForAudit,
    openVaultAccessKeyShowOverlayForAudit,
    openVaultImportUnlockOverlayForAudit,
    openVaultChangeMasterOverlayForAudit,
    openVaultRecoverOverlayForAudit,
    openVaultAdminKeyShowOverlayForAudit,
    openVaultCompromiseOverlayForAudit,
    openVaultCompromiseRecoverOverlayForAudit
  };
}
