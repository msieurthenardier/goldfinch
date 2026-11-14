// @ts-check

import { buildVaultIndicatorModel } from '../../shared/vault-indicator-model.js';
import {
  parsePickIndex,
  MANAGE_ID,
  GENERATE_ID,
  UNLOCK_ID,
  CERTIFICATE_CONTINUE_ID,
  CONFIRM_FILL_ID
} from '../../shared/vault-picker-template.js';
import { savePromptCloseEffects } from '../../shared/save-prompt-close-effects.js';
import { createSavePromptClient } from './save-prompt-client.js';

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
 * }} deps  `toast` is UNUSED since Sortie 06 (the sheet-era save toasts were invisible behind a
 *   guest and are replaced by the corner prompt's result states); it is still ACCEPTED in the type
 *   because renderer.js passes it (that file is at its line budget).
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
  openToolbarContextMenu = () => {}
}) {
  // Human vault flow state machine (M12 F2 Leg 3 pick-and-fill, DD5/DD6). A TRUSTED
  // lock-icon gesture arrives as { wcId, contextId, destination, certificate } (main-derived, no
  // secret; Mission 23 Flight 1 leg `vault-fill-trust` added the last three). From there:
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
  //
  // `generate` (Mission 21, Flight 4, Leg 3 — generate-in-picker, DD5/AC10) carries
  // the main-validated { canGenerate, constraints } from the gesture that opened this
  // flow, when one exists — so the LOCKED unlock-then-pick continuation
  // (onVaultLockState below) can re-show the Generate row once the picker actually
  // opens, and the GENERATE_ID activation (handleActivation below) has the
  // constraints to hand to `vaultFillGenerated`.
  //
  // Mission 23 Flight 1 (`vault-fill-trust`): `contextId` is the per-open picker context main minted when
  // it ACCEPTED the gesture; `destination` (the display string of the page the fill would go to) and
  // `certificate` (the tab's navigation carries a certificate override) ride with it. All three travel
  // through EVERY hop - the unlocked picker, the locked generate/unlock two-row picker, the unlock row,
  // the picker that follows an unlock and the `locked` re-raise after a pick - because every
  // chrome-facing vault channel (`vaultReachableItems`, `vaultFillHuman`, `vaultFillGenerated`) is refused
  // by main without the live context id.
  //
  // Leg `vault-picker-controls`: `destination` is passed to EVERY picker open (a picker with no destination
  // is not opened); `certificate` makes the gesture handler open the certificate WARNING view first on every
  // branch (phase 'certificate'), and Continue acknowledges it in main before the branch runs; a card or
  // identity on a site it has not been confirmed for comes back `confirm-needed` and the flow is restored
  // in phase 'confirming' holding the picked row (`item`) while the confirmation view is up - the same way
  // the `locked` answer restores it for the unlock sheet. Only that view's Fill sends `confirm: true`.
  /** @type {{ wcId: number, contextId: string, destination: string, certificate: boolean, phase: 'unlocking' | 'picking' | 'certificate' | 'confirming', generate?: { canGenerate: boolean, constraints: any } | null, item?: any } | null} */
  let pendingVaultFlow = null;
  /** @type {any[]} the last picker model — the index→item source for dispatch. */
  let lastPickerModel = [];
  /** finalize `reason`s that map to a result-only prompt model (anything else speaks as `error`). */
  const FINALIZE_RESULTS = new Set(['unchanged', 'expired', 'tab-changed', 'locked', 'error']);
  // ---- Corner save prompt queue state (Sortie 06 Leg 1; flight DD1/DD5/DD6) ------------------
  // The save moment is presented in the corner SAVE PROMPT - its own per-window view, never the
  // menu-overlay sheet (the `vault-capture` sheet is retired). The chrome owns the serial queue;
  // MAIN owns "is a sheet visible / is this the active tab / does this capture belong to that
  // tab" and answers `save-prompt:open` with { presented:false, reason } rather than queueing.
  /** @type {{ captureId: string, wcId: number, locked?: boolean } | null} the entry the prompt is CURRENTLY showing
   * (between a successful open and its `save-prompt-closed`). Replaces the retired scalar
   * retired `pendingCaptureId` + `sheetOpen` pair (HISTORY: the sheet-era scalars). */
  let shownEntry = null;
  /** @type {boolean} a `save-prompt:open` invoke is in flight (keeps advance() single-flight). */
  let opening = false;
  /** @type {Array<{ captureId: string, wcId: number, model: any }>} already-resolved offers - or
   * RESULT-ONLY models ({ result }) from a finalize that has nothing to offer - waiting their turn;
   * `advance()` is the ONLY place the head is presented. */
  let presentationQueue = [];
  /** @type {Array<{ captureId: string, wcId: number, consented?: boolean, expired?: boolean }>} the LOCKED-mode pending-unlock queue
   * (M21 F3 L2, DD1's amendment): every captureId released while the vault was locked, awaiting a
   * single unlock-to-save drain; `wcId` rides along from the offer (a result-only model for a
   * dropped record needs it - AC17). Populated at CONSENT time (Sortie 06 Leg 2: the operator
   * clicked "Unlock & save" on the corner prompt), never at offer arrival; the chrome no longer
   * raises the unlock sheet by itself. `expired` is stamped by `vault-capture-dropped` (A7). */
  let pendingCaptureUnlock = [];
  /** @type {Map<string, Promise<any>>} captureIds with a finalize in flight (AC7: the chrome never
   * issues two concurrent finalizes for one capture). */
  const finalizing = new Map();
  // Vault lock indicator (M12 F2 Leg 2 chrome-unlock, DD10). A PURE projection of
  // the pushed `vault-lock-state` (single source of truth = vault-store MRK-present)
  // — never a cache. Hidden until the manager is set up; then locked / unlocked.
  // Leg 3 also STASHES the state (`lockState`) so the gesture handler can decide
  // unlock-first-vs-pick, and CONTINUES a mid-unlock flow to the picker.
  let vaultStatePushed = false;
  /** @type {{ setUp: boolean, unlocked: boolean }} the last-known lock state (stashed). */
  let lockState = { setUp: false, unlocked: false };
  // Sortie 07: "an MCP session holds vault keys" (own channel `vault-automation-held`; never
  // rides vault-lock-state, whose handler runs the unlock continuations). `heldPushed` guards
  // the boot fetch so a late fetch never overwrites a fresher push.
  let automationHeld = false;
  let heldPushed = false;

  /** Open the badged vault picker for a tab: read the origin-filtered, metadata-only
   * reachable items (in main) and raise the vault-picker sheet. Enriches each row with
   * a jar display-name badge (Global vs the jar's name) — the store returns vaultId only.
   * `generate` (Mission 21, Flight 4, Leg 3, AC10), when `canGenerate`, PREPENDS a
   * `{ action: 'generate' }` row ahead of every real item — the unlocked branch of
   * DD5's picker row.
   * @param {{ wcId: number, contextId: string, destination?: string, generate?: { canGenerate: boolean, constraints: any } | null }} flow
   *   the pending flow (its `contextId` is what main checks) */
  async function openVaultPicker(flow) {
    const { wcId, contextId, generate } = flow;
    if (!hasDestination(flow)) return; // never open a picker that cannot say where a fill would go
    let model;
    try {
      model = await goldfinch.vaultReachableItems({ wcId, contextId });
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
    if (generate && generate.canGenerate) {
      lastPickerModel = [{ action: 'generate' }, ...lastPickerModel];
    }
    openPickerSheet(flow, lastPickerModel);
  }

  /** @param {{ destination?: string } | null} flow @returns {boolean} */
  function hasDestination(flow) {
    return !!flow && typeof flow.destination === 'string' && flow.destination !== '';
  }

  /**
   * The ONE place the vault picker sheet is opened: it carries the flow's destination display string (the
   * "Fill on ..." line) and refuses to open without one. Every picker view - the unlocked picker, the locked
   * generate / unlock picker, the certificate warning and the confirmation - goes through here.
   * @param {{ destination?: string }} flow
   * @param {any[]} model
   * @returns {boolean} whether the sheet was opened
   */
  function openPickerSheet(flow, model) {
    if (!hasDestination(flow)) return false;
    return openOverlayMenu('vault-picker', model, null, 0, { destination: flow.destination });
  }

  /** The confirmation view's model: the picked row's non-secret display fields, then Fill and Cancel.
   * @param {any} item */
  function confirmationModel(item) {
    return [
      {
        action: 'confirm-summary',
        type: item && item.type,
        title: item && item.title,
        brand: item && item.brand,
        last4: item && item.last4,
        fullName: item && item.fullName
      },
      { action: 'confirm-fill' },
      { action: 'confirm-cancel' }
    ];
  }

  // Dismiss a held capture in main (the user-declined / un-presentable path). Fire-and-forget.
  /** @param {string} captureId */
  function dismissCapture(captureId) {
    Promise.resolve(goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
  }

  // Remove an id from both queues (main dropped it: `vault-capture-dropped`). Unknown id = no-op.
  /** @param {string} captureId */
  function forgetCapture(captureId) {
    presentationQueue = presentationQueue.filter((e) => e.captureId !== captureId);
    // A7: an entry awaiting unlock is one the operator was shown an unlock sheet for (interim) /
    // consented to (Leg 2) - removing it would make the master-password entry end in SILENCE.
    // Mark it `expired` instead; the post-unlock drain presents the expired result without
    // calling finalize (main already dropped the record).
    for (const e of pendingCaptureUnlock) if (e.captureId === captureId) e.expired = true;
  }

  // The prompt client (Sortie 06). Constructed HERE, never in renderer.js (line budget). Its
  // `onClosed` applies the shared per-reason effects table (DD6) - one source for main and chrome.
  const promptClient = createSavePromptClient({
    goldfinch,
    jarsClient,
    getIndicator: () => els.vaultIndicator,
    onClosed({ captureId, wcId, reason }) {
      shownEntry = null;
      if (reason === 'unlock-requested') {
        // Consent recorded main-side (AC6): queue the capture for the post-unlock drain, then -
        // in the NEXT task, after the prompt is hidden - raise the unlock sheet. No other offer is
        // presented in the gap (the table row has `advance:false`).
        pendingCaptureUnlock.push({ captureId, wcId, consented: true });
        setTimeout(() => {
          if (!pendingCaptureUnlock.some((e) => e.captureId === captureId)) return;
          if (lockState.unlocked) {
            advance();
            return;
          }
          // keepFocus: the consent click is followed by the submit's page load pulling OS focus;
          // the opt-in makes the sheet survive that blur and re-grab focus, so the master
          // password cannot be typed into the page's own fields.
          openOverlayMenu('vault-unlock', [], null, 0, { keepFocus: true });
        }, 0);
        return;
      }
      const fx = savePromptCloseEffects(reason);
      if (fx.clearQueue) {
        presentationQueue = [];
        pendingCaptureUnlock = [];
      } else if (fx.dropTabQueue) {
        // main's dropCapturesForTab already dropped these records: forget, don't dismiss.
        presentationQueue = presentationQueue.filter((e) => e.wcId !== wcId);
        pendingCaptureUnlock = pendingCaptureUnlock.filter((e) => e.wcId !== wcId);
      }
      if (fx.advance) advance();
    }
  });

  // The cheap chrome-side pre-check (DD1): this controller's own overlay flags. They are set at
  // request time and can stick on a refused open, so they only AVOID a pointless round trip -
  // main (`save-prompt:open` -> 'sheet-open') is the authority.
  function anyVaultSheetOpen() {
    for (const st of Object.values(overlayStates)) if (st.open) return true;
    return false;
  }

  // The ONE place a save prompt is opened from a queue (M21 F3 L2, AC5/AC5b; retargeted Sortie 06).
  // IDEMPOTENT and SELF-GUARDING (`shownEntry` / `opening`): every caller - the queued offer
  // arrival, the post-unlock drain, the prompt's own close, and `handleClosed` for ANY menuType
  // (so a head refused for `sheet-open` retries as soon as any sheet closes) - can call it freely.
  // Order: the presentation queue first; if it is empty and a locked drain remains (vault now
  // unlocked), finalize the NEXT locked entry and re-enter - a successful finalize is pushed onto
  // the SAME queue and travels the same path as any other offer.
  function advance() {
    if (shownEntry || opening) return;
    if (presentationQueue.length > 0) {
      const head = presentationQueue[0];
      // A LOCKED model is never presented while the vault is unlocked (any route): finalize it
      // first - without consent - and present what it resolves to (AC9). Done BEFORE the sheet
      // check: finalizing presents nothing.
      if (head.model && head.model.mode === 'locked' && lockState.unlocked) {
        opening = true;
        finalizeOnce(head.captureId)
          .then((offer) => {
            opening = false;
            const mapped = mapFinalize(offer);
            const i = presentationQueue.indexOf(head);
            if (i >= 0) {
              if (mapped) presentationQueue[i] = { captureId: head.captureId, wcId: head.wcId, model: mapped };
              else presentationQueue.splice(i, 1);
            }
            if (!mapped) dismissCapture(head.captureId);
            advance();
          })
          .catch(() => {
            opening = false;
          });
        return;
      }
      if (anyVaultSheetOpen()) return;
      const total = presentationQueue.length + pendingCaptureUnlock.length;
      opening = true;
      promptClient
        .present({ captureId: head.captureId, wcId: head.wcId, model: head.model, queue: { index: 1, total } })
        .then((res) => {
          opening = false;
          if (res.presented) {
            presentationQueue = presentationQueue.filter((e) => e !== head);
            shownEntry = {
              captureId: head.captureId,
              wcId: head.wcId,
              locked: !!head.model && head.model.mode === 'locked'
            };
            return;
          }
          // 'sheet-open': keep the head and retry when a sheet closes. Anything else
          // ('not-active' / 'fullscreen' / 'gone' / 'invalid-model'): the offer cannot be
          // shown - drop it main-side and move on.
          if (res.reason === 'sheet-open') return;
          presentationQueue = presentationQueue.filter((e) => e !== head);
          dismissCapture(head.captureId);
          advance();
        })
        .catch(() => {
          // A throw inside the handler must never wedge the queue: reset the in-flight flag; the
          // head (if still queued) is retried by the next advance() trigger.
          opening = false;
        });
      return;
    }
    if (pendingCaptureUnlock.length === 0) return;
    // A locked entry is only finalized once the vault is unlocked (any route): finalizing a
    // still-locked record would answer `locked` and flash a failure result for nothing.
    if (!lockState.unlocked) return;
    const entry = /** @type {{ captureId: string, wcId: number, expired?: boolean }} */ (pendingCaptureUnlock.shift());
    if (entry.expired) {
      // Main dropped the record while we awaited the unlock (A7): say so, no finalize.
      presentationQueue.push({ captureId: entry.captureId, wcId: entry.wcId, model: { result: 'expired' } });
      advance();
      return;
    }
    opening = true;
    finalizeOnce(entry.captureId)
      .then((offer) => {
        opening = false;
        const mapped = mapFinalize(offer);
        if (mapped) presentationQueue.push({ captureId: entry.captureId, wcId: entry.wcId, model: mapped });
        else dismissCapture(entry.captureId);
        advance(); // drains the rest of the locked queue regardless of this entry's outcome
      })
      .catch(() => {
        opening = false;
      });
  }

  // The ONE finalize caller (AC7): at most one in flight per captureId (a second caller shares the
  // first's promise). Always resolves - a rejected invoke becomes `{ reason: 'error' }`.
  /** @param {string} captureId @returns {Promise<any>} */
  function finalizeOnce(captureId) {
    const inFlight = finalizing.get(captureId);
    if (inFlight) return inFlight;
    /** @type {Promise<any>} */
    let call;
    try {
      call = Promise.resolve(goldfinch.vaultCaptureFinalize(captureId));
    } catch {
      call = Promise.reject(new Error('finalize threw'));
    }
    const p = call.catch(() => ({ reason: 'error' })).finally(() => finalizing.delete(captureId));
    finalizing.set(captureId, p);
    return p;
  }

  // Map a finalize answer to the model to present: the offer (a re-ask), the `saved` result, or a
  // RESULT-ONLY model saying why there is nothing to save. `refused` -> null (present nothing; the
  // caller drops the capture).
  /** @param {any} offer @returns {any} */
  function mapFinalize(offer) {
    if (offer && offer.saved === true) {
      return {
        result: 'saved',
        vaultLabel: promptClient.labelChoice(String(offer.vaultId)).label,
        kind: offer.kind
      };
    }
    if (offer && offer.model) return offer.model;
    const reason = offer && typeof offer.reason === 'string' ? offer.reason : 'error';
    if (reason === 'refused') return null;
    return { result: FINALIZE_RESULTS.has(reason) ? reason : 'error' };
  }

  // The vault unlocked (by ANY route) while a LOCKED prompt is on screen: convert it in place
  // (AC9). Finalize ONCE without consent, put the result at the HEAD of the queue, forget the
  // shown locked entry so advance() can run; the present is a model-replace of the visible prompt
  // (or is retried on the unlock sheet's close when main answers `sheet-open`).
  function convertShownLocked() {
    const entry = shownEntry;
    if (!entry || !entry.locked) return;
    shownEntry = null;
    opening = true;
    finalizeOnce(entry.captureId)
      .then((offer) => {
        opening = false;
        const mapped = mapFinalize(offer);
        if (mapped) presentationQueue.unshift({ captureId: entry.captureId, wcId: entry.wcId, model: mapped });
        else dismissCapture(entry.captureId);
        advance();
      })
      .catch(() => {
        opening = false;
      });
  }

  /** Render from BOTH stashes (lock state + automation-held). */
  function renderVaultIndicator() {
    const el = els.vaultIndicator;
    if (!el) return;
    const model = buildVaultIndicatorModel({ ...lockState, automationHeld });
    el.classList.toggle('hidden', !model.visible);
    el.classList.toggle('vault-locked', model.visible && model.state === 'locked');
    el.classList.toggle('vault-unlocked', model.visible && model.state === 'unlocked');
    el.classList.toggle('vault-automation-held', model.automationHeld);
    const label = model.automationHeld
      ? 'Vault locked — automation has vault access'
      : model.visible && model.state === 'unlocked'
        ? 'Vault unlocked'
        : 'Vault locked';
    el.setAttribute('aria-label', label);
    el.title = model.automationHeld ? label : 'Vault';
  }

  /** Whether the vault is currently locked (squawk 0038's "Lock now" context-menu item
   * omit gate) — reads the stashed `lockState` (DD10 freshness contract: a pure
   * projection of the pushed vault-lock-state, never re-fetched). Also true before the
   * manager is set up; the indicator itself is hidden then (unreachable in practice). */
  function isVaultLocked() {
    return !lockState.unlocked;
  }

  /** The toolbar vault context-menu opts (Sortie 07): both stashes, spread into pageContextModel. */
  function vaultMenuOpts() {
    return { vaultLocked: isVaultLocked(), automationHeld };
  }

  /** The vault indicator's context-menu "Lock now" action: the SAME explicit
   * vault-lock path the goldfinch://vault page's inline "Lock now" button drives
   * (`bridge.lockVault()` there → `internal-vault-lock`; `goldfinch.vaultLock()` here →
   * `vault-lock` — one IPC-gate chrome-class handler and one internal-gated handler over the shared main-side `vaultLockNow()`,
   * idempotent + global, Mission 12). No local state mutation: the store's `onLock` hook
   * already fires the `vault-lock-state` broadcast that re-renders the indicator. */
  function lockNow() {
    Promise.resolve(goldfinch.vaultLock()).catch(() => {});
  }

  /** The vault indicator's "Unlock now" action (Flight 4 Leg 5 HAT fix — the locked
   * toolbar right-click menu used to OMIT "Lock now" entirely, opening an empty
   * dropdown; the operator ruling replaces it with this single item, which runs the
   * EXACT SAME body as a left click on the locked indicator: Flight 4 Leg 1 deliberately
   * uses the `onVaultRequestUnlock` SHAPE, not `onVaultGesture`'s locked branch —
   * `pendingVaultFlow` stays unset, so a subsequent unlock does not spring the fill
   * picker (there is no gesture/wcId behind this click/menu item to pick for). Guarded
   * on `setUp` for symmetry with the click handler, even though the indicator (and its
   * context menu) is hidden before setup in practice. */
  function unlockNow() {
    if (!lockState.setUp) return;
    openOverlayMenu('vault-unlock', [], null, 0);
  }

  /** Routes the toolbar vault indicator's right-click menu item id to the lock/unlock
   * bodies above (squawk 0038 + the Flight 4 Leg 5 HAT fix) — anything other than
   * 'lock'/'unlock' is a validated no-op (page-context-model.js's id-space discipline). */
  function indicatorAction(action) {
    if (action === 'lock') lockNow();
    else if (action === 'unlock') unlockNow();
  }

  // Right-click → the shared toolbar-mode page-context sheet (squawk 0038, GitHub #113
  // "Lock now" half — the pinnable half is DECLINED by operator ruling: the indicator
  // stays put and is NEVER added to toolbarPins/UNPIN_LABELS). Same wiring shape as the
  // media/shields/devtools pin buttons' own contextmenu listeners (CLAUDE.md's Toolbar-
  // pins pattern); the model swaps to "Unlock now" when already locked (Flight 4 Leg 5
  // HAT fix — page-context-model.js, opts.vaultLocked below). Guarded on
  // `els.vaultIndicator` for the offline harnesses that construct with
  // `els: { vaultIndicator: null }` (no DOM).
  if (els.vaultIndicator) {
    els.vaultIndicator.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openToolbarContextMenu('vault', els.vaultIndicator);
    });

    // Left-click (squawk 0099, flight DD10): locked → raise the F2 unlock sheet;
    // unlocked → open the Secrets page (goldfinch://vault). The indicator is a native
    // <button>, so Enter/Space fire this same `click` — no keydown handler needed.
    // Deliberately uses the `onVaultRequestUnlock` SHAPE, not `onVaultGesture`'s locked
    // branch: `pendingVaultFlow` stays unset, so a subsequent unlock does not spring the
    // fill picker (there is no gesture/wcId behind this click to pick for).
    els.vaultIndicator.addEventListener('click', () => {
      if (!lockState.setUp) return; // defense in depth — the indicator is hidden then.
      if (lockState.unlocked) openVaultPage();
      else unlockNow();
    });
  }

  /**
   * Run the branch a gesture takes once any certificate warning is out of the way (unlocked -> the picker;
   * locked with a Generate offer -> the generate / unlock picker; locked otherwise -> the unlock sheet).
   * The lock state is read HERE, at the time the branch runs (after a Continue the vault may have changed).
   * @param {{ wcId: number, contextId: string, destination: string, certificate: boolean, generate?: any }} flow
   */
  function runGestureBranch(flow) {
    const { wcId, contextId, destination, certificate, generate } = flow;
    // Generate-in-picker (Mission 21, Flight 4, Leg 3 — generate-in-picker, DD5):
    // `generate` is main-validated ({ canGenerate, constraints } or absent/malformed).
    // canGenerate false/absent behaves EXACTLY as today, in both lock states.
    const canGenerate = !!(generate && generate.canGenerate);
    if (lockState.unlocked) {
      pendingVaultFlow = {
        wcId,
        contextId,
        destination,
        certificate,
        phase: 'picking',
        generate: canGenerate ? generate : null
      };
      openVaultPicker(pendingVaultFlow);
    } else if (canGenerate) {
      // Locked-vault branch, ONE state machine (DD5): show Generate + Unlock rows
      // WITHOUT unlocking and WITHOUT a store read — reachableItems is never even
      // invoked. Choosing Unlock (handleActivation's UNLOCK_ID case) enters the
      // SAME 'unlocking' phase a today's locked gesture would, so there remains one
      // unlock-then-pick entry point, not two.
      pendingVaultFlow = { wcId, contextId, destination, certificate, phase: 'picking', generate };
      lastPickerModel = [{ action: 'generate' }, { action: 'unlock' }];
      openPickerSheet(pendingVaultFlow, lastPickerModel);
    } else {
      // Locked → raise the Leg-2 unlock prompt first; onVaultLockState continues to the
      // picker on a successful unlock. openOverlayMenu is POSITIONAL (menuType, model,
      // anchor, startIndex, opts); the vault-unlock card is centered (anchor ignored).
      pendingVaultFlow = { wcId, contextId, destination, certificate, phase: 'unlocking', generate: null };
      openOverlayMenu('vault-unlock', [], null, 0);
    }
  }

  goldfinch.onVaultGesture(({ wcId, contextId, destination, certificate, generate }) => {
    if (!lockState.setUp) return; // manager not set up — no setup UI in F2 (DD; F3 owns setup).
    const flow = { wcId, contextId, destination, certificate, generate };
    if (certificate === true) {
      // The tab's navigation carries a certificate override: the WARNING view comes first on EVERY branch
      // (including the locked one that would otherwise raise the unlock sheet) - no items, no generate row,
      // no footer. Main refuses every operation for this context until the operator acknowledges it.
      // `generate` is KEPT on the flow (the warning view itself offers no generate row): Continue runs the branch
      // the gesture would have run, including the locked generate / unlock picker.
      pendingVaultFlow = { ...flow, certificate: true, phase: 'certificate' };
      lastPickerModel = [{ action: 'certificate-continue' }];
      if (!openPickerSheet(pendingVaultFlow, lastPickerModel)) pendingVaultFlow = null;
      return;
    }
    runGestureBranch(flow);
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
  // amendment; presented in the corner prompt since Sortie 06). Main forwards { captureId, model,
  // wcId } after a login/card/identity-form submit in a set-up, persistent-jar tab (model =
  // metadata only - NEVER a password; the captured secret lives only in the main-side held
  // record). Main ALREADY gated the send to the window's ACTIVE tab (DD5), so the chrome adds no
  // arrival check. A settle can release MULTIPLE families for one tab, so main pushes ONE offer
  // per family; each push arrives here as its own call.
  goldfinch.onVaultCaptureOffer(({ captureId, model, wcId }) => {
    // A LOCKED offer is queued like any other (Sortie 06 Leg 2, AC4): it presents in the corner
    // with "Unlock & save", and NOTHING raises the unlock sheet here - the operator's click
    // records consent main-side first (`save-prompt-closed` `unlock-requested`, above).
    // Queue the offer and let advance() present it - never open it directly (truly serial, never
    // a model-replace). advance() no-ops while one is showing.
    presentationQueue.push({ captureId, wcId, model });
    advance();
  });

  // Main dropped a held OFFER the chrome did not initiate (CAPTURE_DROP_MS, tab-changed, tab /
  // window close, lock, supersession). Main is the source of truth for capture existence; the
  // chrome queue is advisory and corrected by this push. An unknown id is a no-op. If it is the
  // SHOWN capture, main flips the prompt to its expired state itself.
  goldfinch.onVaultCaptureDropped(({ captureId }) => {
    if (typeof captureId === 'string') forgetCapture(captureId);
  });

  // Subscribe FIRST, then fetch the initial state — so a transition that fires
  // between subscribe and fetch is not lost, and a fresher push always wins over a
  // late init fetch (DD10 freshness contract).
  goldfinch.onVaultLockState((/** @type {{ setUp: boolean, unlocked: boolean }} */ state) => {
    vaultStatePushed = true;
    lockState = state;
    renderVaultIndicator();
    // Continue a mid-unlock flow ONLY when we are the tab that raised the unlock
    // prompt (phase === 'unlocking') and the store is now unlocked — the phase guard
    // stops an unrelated later unlock (recovery/admin, or another tab) from springing
    // the picker on a stale tab.
    if (pendingVaultFlow && pendingVaultFlow.phase === 'unlocking' && state.unlocked) {
      pendingVaultFlow.phase = 'picking';
      // `pendingVaultFlow.generate` (AC10) survives the unlock — a Generate row
      // opened while locked, then routed through Unlock, re-shows on the now-
      // unlocked full picker rather than being lost.
      openVaultPicker(pendingVaultFlow);
    }
    // Unlock-to-save continuation (M21 F3 L2, DD1's amendment): a login/card-form
    // submit into a LOCKED vault held the credential(s) and raised the unlock prompt;
    // on success START THE DRAIN via advance() — it finalizes the queued captureIds
    // ONE AT A TIME (via vaultCaptureFinalize), each resolving into a real offer on
    // the SAME presentation queue as any other, before the next is finalized (AC6).
    // advance() is idempotent/self-guarding (AC5b) — calling it here even when
    // `pendingCaptureUnlock` is empty, or repeatedly across unrelated unlock
    // broadcasts, is a harmless no-op.
    if (state.unlocked) {
      // Convert a visible LOCKED prompt in place (AC9; the unlock may have come from any route,
      // including another window); queued locked heads convert when advance() reaches them.
      convertShownLocked();
      if (pendingCaptureUnlock.length > 0 || presentationQueue.length > 0) advance();
    }
  });
  goldfinch
    .getVaultLockState()
    .then((/** @type {{ setUp: boolean, unlocked: boolean }} */ state) => {
      lockState = state;
      if (!vaultStatePushed) renderVaultIndicator();
    })
    .catch(() => {});
  // Sortie 07: subscribe FIRST, then fetch; the fetch applies ONLY if no push arrived (it
  // neither stashes nor renders otherwise). Never runs the lock-state continuations.
  goldfinch.onVaultAutomationHeld((/** @type {{ held: boolean }} */ d) => {
    heldPushed = true;
    automationHeld = !!(d && d.held);
    renderVaultIndicator();
  });
  goldfinch
    .getVaultAutomationHeld()
    .then((/** @type {{ held: boolean }} */ d) => {
      if (heldPushed) return;
      automationHeld = !!(d && d.held);
      renderVaultIndicator();
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
  // at all (vault-unlock, vault-set, vault-stepup, vault-import-unlock,
  // vault-change-master, vault-recover, vault-compromise-recover) — those fall through
  // exactly as they did when `dispatchOverlayActivation`'s switch had no case for them
  // (unchanged behavior).
  /**
   * Dispatch a human fill for a picked row (and, with `confirm`, the confirmation view's Fill). The answer
   * restores the flow where the operator has to act again: `locked` -> the unlock sheet (the context survives
   * the lock; after the unlock the PLAIN picker reopens, so a re-pick asks for confirmation again because
   * only the confirmation view sends `confirm: true`), `confirm-needed` -> the confirmation view.
   * @param {{ wcId: number, contextId: string, destination: string, certificate: boolean }} flow
   * @param {any} item  the picked row (metadata only)
   * @param {boolean} confirm
   */
  function dispatchFill(flow, item, confirm) {
    const { wcId, contextId } = flow;
    /** @type {any} */
    const payload = { wcId, vaultId: item.vaultId, itemId: item.id, contextId };
    if (confirm) payload.confirm = true;
    Promise.resolve(goldfinch.vaultFillHuman(payload))
      .then((/** @type {any} */ r) => {
        if (r && r.reason === 'locked') {
          // The context survives a lock (main keeps it); the re-raised unlock sheet continues the SAME
          // open, so the id, destination and certificate flag stay with the flow.
          pendingVaultFlow = { ...flow, phase: 'unlocking', generate: null, item: undefined };
          openOverlayMenu('vault-unlock', [], null, 0);
        } else if (r && r.reason === 'confirm-needed') {
          // A card / identity on a site it has not been confirmed for: reopen the picker as the
          // confirmation view, holding the picked row so its Fill can send the explicit confirm.
          pendingVaultFlow = { ...flow, phase: 'confirming', generate: null, item };
          lastPickerModel = confirmationModel(item);
          if (!openPickerSheet(pendingVaultFlow, lastPickerModel)) pendingVaultFlow = null;
        }
      })
      .catch(() => {});
  }

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
      // Generate-in-picker action rows (Mission 21, Flight 4, Leg 3, AC11).
      if (id === GENERATE_ID) {
        const genWcId = pendingVaultFlow ? pendingVaultFlow.wcId : null;
        const genContextId = pendingVaultFlow ? pendingVaultFlow.contextId : null;
        const constraints =
          pendingVaultFlow && pendingVaultFlow.generate ? pendingVaultFlow.generate.constraints : null;
        pendingVaultFlow = null;
        if (genWcId == null || genContextId == null || !constraints) return true;
        // Main re-validates + re-resolves the constraints (never trusting what it
        // itself handed the chrome earlier) and generates + fills entirely main-side
        // — the chrome never receives or holds the generated password. A resolved
        // { filled:false } (a page mutation raced the fill, or the gate refused)
        // shows no sheet — the operator can simply click the badge again.
        Promise.resolve(goldfinch.vaultFillGenerated({ wcId: genWcId, contextId: genContextId, constraints })).catch(
          () => {}
        );
        return true;
      }
      // Leg `vault-picker-controls`: Continue on the certificate warning view. Acknowledge in MAIN first (the
      // context refuses everything until then), and only if this is still the same flow run the branch the
      // gesture would have run.
      if (id === CERTIFICATE_CONTINUE_ID) {
        const flow = pendingVaultFlow;
        if (!flow || flow.phase !== 'certificate') return true;
        Promise.resolve(goldfinch.vaultCertificateAcknowledge({ wcId: flow.wcId, contextId: flow.contextId }))
          .then((/** @type {any} */ r) => {
            if (r && r.ok && pendingVaultFlow === flow) runGestureBranch(flow);
          })
          .catch(() => {});
        return true;
      }
      // The confirmation view's Fill: the ONE sender of `confirm: true`. Cancel never reaches here (it is a
      // dismissal in the sheet).
      if (id === CONFIRM_FILL_ID) {
        const flow = pendingVaultFlow;
        if (!flow || flow.phase !== 'confirming' || !flow.item) return true;
        pendingVaultFlow = null;
        dispatchFill(flow, flow.item, true);
        return true;
      }
      if (id === UNLOCK_ID) {
        // Enter the SAME 'unlocking' phase today's locked gesture uses — keeping
        // wcId + generate so the post-unlock continuation (onVaultLockState above)
        // re-shows the Generate row on the now-unlocked full picker.
        if (pendingVaultFlow) pendingVaultFlow.phase = 'unlocking';
        openOverlayMenu('vault-unlock', [], null, 0);
        return true;
      }
      const idx = parsePickIndex(id);
      const item = idx != null ? lastPickerModel[idx] : null;
      const flow = pendingVaultFlow;
      pendingVaultFlow = null;
      if (!item || !flow) return true;
      dispatchFill(flow, item, false);
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
    // Leg `vault-picker-controls`: the certificate warning or the confirmation view was dismissed (Escape,
    // the header X, Cancel, the backdrop, a blur, a tab switch ...) - abandon the flow. An activation
    // (Continue / Fill / a pick) and a model replace (`superseded`) are NOT abandonment.
    if (
      menuType === 'vault-picker' &&
      reason !== 'activated' &&
      reason !== 'superseded' &&
      pendingVaultFlow &&
      (pendingVaultFlow.phase === 'certificate' || pendingVaultFlow.phase === 'confirming')
    ) {
      pendingVaultFlow = null;
    }
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
    // NO 'superseded' carve-out here - deliberately. A NEWER capture's unlock prompt is the SAME
    // menuType, so `open()` bumps this menuType's chrome-side token BEFORE main emits the
    // superseded channel 7 for the OLD one, and overlay-menus.js drops that stale-token close
    // without ever reaching here — the case the sibling guard protects against cannot arrive.
    // What DOES arrive is a supersede by an UNRELATED menu (kebab, suggestions), where
    // pendingCaptureUnlock still names these captures, the prompt is gone, and dropping the
    // held secrets promptly is the conservative answer.
    if (menuType === 'vault-unlock' && pendingCaptureUnlock.length > 0 && !lockState.unlocked) {
      const entries = pendingCaptureUnlock;
      pendingCaptureUnlock = [];
      for (const entry of entries) dismissCapture(entry.captureId);
    }
    // The `vault-capture` sheet branch is RETIRED (Sortie 06, DD8): the save prompt is its own
    // view with its own close channel (`save-prompt-closed`, applied in the prompt client's
    // `onClosed` via the shared per-reason table), so its reasons never flow through here.
    //
    // ANY menuType closing may unblock a head that main refused with `sheet-open` (address-bar
    // suggestions, the downloads popup, kebab, ... all count as "a sheet is visible"), so retry.
    // `advance()` is cheap and idempotent. Deliberately LAST: the unlock-abandoned drop above has
    // already emptied its queue.
    advance();
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
    vaultMenuOpts,
    lockNow,
    unlockNow,
    indicatorAction,
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
