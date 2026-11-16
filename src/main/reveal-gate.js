// @ts-check
'use strict';

// The reveal gate (Mission 23 Flight 2, leg `admin-reach`, flight DD2).
//
// An admin automation key can run script inside a `goldfinch://` page, where the internal bridge hands
// back vault secrets, cookie values and freshly minted keys. The internal-origin check keeps WEB pages
// out; it does nothing about script the operator's own automation evaluated in an internal page. So,
// while that threat exists, every handler that returns a secret (or mints a key, or lets the caller pick
// where an encrypted bundle is written) takes a NATIVE confirmation that no automation tier can see or
// answer (a `dialog.showMessageBox` parented on the window, outside every contents automation can reach).
//
// The gate applies when EITHER
//   (a) an admin-identity automation session is attached (`hasAdminSession`), or
//   (b) automation has evaluated script in the calling document since it loaded (the "scripted" mark: a
//       script can set a timer and outlive its session). Injected clicks and keys leave nothing behind
//       and set no mark; a reveal they drive while the session is attached is caught by (a).
// When neither holds the answer is 'not-applicable' and NOTHING else happens - no dialog, no state.
//
// Electron-free, injected deps (the house shape), so the whole decision runs under `node --test`.
//
// Decisions (exactly one per `confirm`, never a throw):
//   'not-applicable'  neither condition holds
//   'confirmed'       the operator chose the affirmative button (or a per-item grant already covers it)
//   'denied'          the operator chose Cancel / closed the dialog / an internal error
//   'timeout'         nobody answered inside 60 s (the dialog is aborted)
//   'busy'            a confirmation is already open for this window (stacked dialogs only cancel
//                     newest-first, so exactly one is ever open per window - a second is refused, never queued)
//   'gone'            the sender is not a window's contents, or it navigated / was destroyed / its window
//                     closed while the dialog was up, or (the "stranding" rules, fix 1 of leg
//                     `hat-and-alignment`) it is not its window's active tab, its tab stopped being in
//                     front while the dialog was up, or real input reached the window while it was up
//   'refused-frame'   the sender is not the main frame of its webContents
//
// One grant, scoped to an item: after 'confirmed' for a vault reveal OR code read of (vaultId, itemId),
// later reveals and code reads of THE SAME item from the SAME document are 'confirmed' without a dialog
// (the page asks per field, and the code widget polls). Nothing else is remembered. A grant lives and
// dies with the document, exactly like the scripted mark (`createDocumentMarks`).

const { cleanDisplayText } = require('./display-text');

/** How long an unanswered confirmation stays up. */
const CONFIRM_TIMEOUT_MS = 60000;
/** Longest piece of main-supplied text placed in the dialog (ellipsis included). */
const DISPLAY_MAX_CHARS = 80;
/**
 * Real input to a window is ignored for this long after its dialog is requested: the click or key that
 * opened the dialog may still be in flight (a held Enter must not cancel its own dialog).
 */
const INPUT_GRACE_MS = 400;

/** Button indexes: Cancel FIRST, so a stray Enter / Escape / window close is a refusal. */
const CANCEL_INDEX = 0;
const AFFIRM_INDEX = 1;

/**
 * What each request kind says. `question` is the dialog message (the cleaned subject is spliced in),
 * `affirm` the affirmative button.
 * @type {Record<string, { question: (subject: string) => string, affirm: string, what: string }>}
 */
const ACTIONS = {
  reveal: { question: (s) => `Show the secrets stored in "${s}"?`, affirm: 'Show', what: 'what is shown' },
  code: { question: (s) => `Show the one-time code for "${s}"?`, affirm: 'Show code', what: 'what is shown' },
  cookie: { question: (s) => `Show the value of the cookie "${s}"?`, affirm: 'Show value', what: 'what is shown' },
  export: { question: (s) => `Export ${s} to an encrypted file?`, affirm: 'Export', what: 'the file that is written' },
  'jar-key-mint': {
    question: (s) => `Create a new automation key for "${s}"?`,
    affirm: 'Create key',
    what: 'the key that is shown'
  },
  'admin-key-mint': {
    question: () => 'Create a new admin automation key?',
    affirm: 'Create key',
    what: 'the key that is shown'
  }
};

/**
 * Per-document state: the scripted mark and the per-item grants. Keyed on the tab's webContents id; one
 * `onCommit` (a main-frame navigation that is not in-page) or `forget` (destroyed) drops both - the script
 * and everything the operator confirmed for it died with the document. A reload may reuse the frame, so the
 * frame token is not the discriminator; the commit event is.
 */
function createDocumentMarks() {
  /** @type {Set<number>} */
  const scripted = new Set();
  /** @type {Map<number, Set<string>>} */
  const grants = new Map();
  /** Bumped by `clearGrants`; a grant carrying an older epoch (a dialog that straddled a lock) is not stored. */
  let epoch = 0;

  /** @param {number} wcId */
  function drop(wcId) {
    scripted.delete(wcId);
    grants.delete(wcId);
  }
  return {
    /** @param {number} wcId */
    markScripted(wcId) {
      if (typeof wcId === 'number') scripted.add(wcId);
    },
    /** @param {number} wcId */
    isScripted(wcId) {
      return scripted.has(wcId);
    },
    /**
     * @param {number} wcId
     * @param {string} key
     * @param {number} [atEpoch] the `epoch()` read before the dialog opened; stale = not stored
     */
    grant(wcId, key, atEpoch) {
      if (atEpoch !== undefined && atEpoch !== epoch) return;
      let set = grants.get(wcId);
      if (!set) grants.set(wcId, (set = new Set()));
      set.add(key);
    },
    /**
     * @param {number} wcId
     * @param {string} key
     */
    hasGrant(wcId, key) {
      return grants.get(wcId)?.has(key) === true;
    },
    /** The grant epoch: read it BEFORE a confirmation opens and hand it back to `grant`. */
    epoch: () => epoch,
    /** Every per-item grant in every document dies (a vault lock): the next reveal asks again. */
    clearGrants() {
      epoch++;
      grants.clear();
    },
    onCommit: drop,
    forget: drop,
    /** Test/diagnostic only: how many documents hold any state. */
    size: () => new Set([...scripted, ...grants.keys()]).size
  };
}

/**
 * @typedef {object} GateRequest
 * @property {string} channel   the channel literal (trace only)
 * @property {'reveal'|'code'|'cookie'|'export'|'jar-key-mint'|'admin-key-mint'} action
 * @property {string} [subject] MAIN's own text for the item / cookie / jar / vault(s); cleaned here
 * @property {string} [destination] export only: the destination folder's name; cleaned here
 * @property {{ vaultId: string, itemId: string }} [grant] reveal / code only: the per-item grant scope
 */

/**
 * @typedef {'not-applicable'|'confirmed'|'denied'|'timeout'|'busy'|'gone'|'refused-frame'} GateDecision
 */

/**
 * @param {object} deps
 * @param {() => boolean} deps.hasAdminSession   late-bound: no server reads false
 * @param {(wcId: number) => boolean} deps.isTouched   the scripted mark; a throw counts as touched
 * @param {(wcId: number, key: string) => boolean} [deps.hasGrant]
 * @param {(wcId: number, key: string, epoch?: number) => void} [deps.addGrant]
 * @param {() => number} [deps.grantEpoch]   read before the dialog opens, handed back to `addGrant`
 * @param {(win: any, options: any, signal: AbortSignal) => Promise<{ response?: number, cancelId?: number }>} deps.showConfirm
 * @param {(sender: any) => any} deps.windowFor   the sender's window, resolved main-side; null = none
 * @param {(sender: any, win: any, onGone: () => void) => (() => void)} deps.watch
 *        subscribes the abort to the sender's `did-navigate` / `destroyed` and the window's `close`;
 *        returns the disposer. Injected so this module never touches an emitter.
 * @param {(sender: any) => boolean} [deps.isActive]   is the sender its window's active tab? default true;
 *        a throw counts as inactive. A background tab never gets a dialog.
 * @param {() => number} [deps.now]   clock (ms) for the input grace period
 * @param {(fn: () => void, ms: number) => any} [deps.setTimeout]
 * @param {(handle: any) => void} [deps.clearTimeout]
 * @param {(line: string) => void} [deps.trace]
 */
function createRevealGate({
  hasAdminSession,
  isTouched,
  hasGrant = () => false,
  addGrant = () => {},
  grantEpoch = () => 0,
  showConfirm,
  windowFor,
  watch,
  isActive = () => true,
  now = () => Date.now(),
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
  trace = () => {}
}) {
  /**
   * One open confirmation per window (keyed on the window object). Each entry carries the requesting
   * sender's id, the time it opened and a `cancel()` that finishes it as an interrupted `gone`.
   * @type {Map<any, { requesterId: any, openedAt: number, cancel: () => void }>}
   */
  const open = new Map();

  /**
   * @param {GateRequest} request
   * @param {GateDecision} decision
   * @param {string} reason
   * @returns {GateDecision}
   */
  function traced(request, decision, reason) {
    try {
      trace(`[reveal-gate] channel=${request && request.channel} decision=${decision} reason=${reason}`);
    } catch {
      // a trace sink must never change a decision
    }
    return decision;
  }

  /** @param {any} event */
  function isMainFrameSender(event) {
    try {
      const frame = event && event.senderFrame;
      const main = event && event.sender && event.sender.mainFrame;
      if (!frame || !main) return false;
      const a = frame.frameTreeNodeId;
      return typeof a === 'number' && a === main.frameTreeNodeId;
    } catch {
      return false;
    }
  }

  /** @param {GateRequest} request @param {string} reason */
  function buildOptions(request, reason) {
    const spec = ACTIONS[request.action] || ACTIONS.reveal;
    const subject = cleanDisplayText(request.subject, DISPLAY_MAX_CHARS) || 'this item';
    let message = spec.question(subject);
    const destination = cleanDisplayText(request.destination, DISPLAY_MAX_CHARS);
    if (request.action === 'export' && destination) message += ` Destination folder: "${destination}".`;
    const detail =
      reason === 'admin-attached'
        ? `An automation connection has been active in this browser recently and will be able to read ${spec.what}. Choose Cancel unless you started this yourself.`
        : `Automation ran script in this page and may still be running it; it will be able to read ${spec.what}. Choose Cancel unless you started this yourself.`;
    return {
      type: 'question',
      title: 'Goldfinch',
      message,
      detail,
      buttons: ['Cancel', spec.affirm],
      defaultId: CANCEL_INDEX,
      cancelId: CANCEL_INDEX,
      noLink: true
    };
  }

  /**
   * Decide one request. Never throws.
   * @param {any} event  the IPC event (sender, senderFrame)
   * @param {GateRequest} request
   * @param {{ interrupted?: boolean }} [info]  optional out-param: `interrupted` is set when the decision is
   *        a `gone` that the OPERATOR did not cause by navigating away (the sender is not in front, its tab
   *        stopped being in front, or real input reached the window). No new decision value, no trace text.
   * @returns {Promise<GateDecision>}
   */
  async function confirm(event, request, info) {
    /** @param {GateRequest} r @param {string} why */
    const interruptedGone = (r, why) => {
      if (info && typeof info === 'object') info.interrupted = true;
      return traced(r, 'gone', why);
    };
    /** @type {string} */
    let reason = 'admin-attached';
    try {
      const sender = event && event.sender;
      const wcId = sender && sender.id;
      /** @type {boolean} */
      let admin;
      try {
        admin = hasAdminSession() === true;
      } catch {
        admin = true; // unreadable = conservative
      }
      /** @type {boolean} */
      let touched = false;
      if (!admin) {
        try {
          touched = isTouched(wcId) === true;
        } catch {
          touched = true; // a lookup that throws counts as touched
        }
      }
      if (!admin && !touched) return 'not-applicable';
      reason = admin ? 'admin-attached' : 'touched';

      if (!isMainFrameSender(event)) return traced(request, 'refused-frame', reason);

      let win;
      try {
        win = windowFor(sender);
      } catch {
        win = null;
      }
      if (!win) return traced(request, 'gone', reason);

      // A background tab gets no dialog (and is never answered from a grant, never told `busy`).
      /** @type {boolean} */
      let active;
      try {
        active = isActive(sender) === true;
      } catch {
        active = false;
      }
      if (!active) return interruptedGone(request, reason);

      const grantKey = request.grant ? `${request.grant.vaultId}\u0000${request.grant.itemId}` : null;
      if (grantKey !== null && hasGrant(wcId, grantKey)) return traced(request, 'confirmed', reason);

      if (open.has(win)) return traced(request, 'busy', reason);

      const options = buildOptions(request, reason);
      let epochAtOpen = 0;
      try {
        epochAtOpen = grantEpoch();
      } catch {
        // no epoch = the default 0; a grant is then stored as before
      }
      const controller = new AbortController();
      /** @type {(d: GateDecision) => void} */
      let settle = () => {};
      /** @type {Promise<GateDecision>} */
      const done = new Promise((resolve) => {
        settle = resolve;
      });
      let finished = false;
      let interrupted = false;
      /** @type {any} */
      let timer = null;
      /** @type {() => void} */
      let unwatch = () => {};
      /**
       * Settle exactly once; release the window's slot HERE, on the abort - never on the dialog's promise
       * (a dialog whose window closed may never settle).
       * @param {GateDecision} decision
       * @param {boolean} abort
       */
      const finish = (decision, abort) => {
        if (finished) return;
        finished = true;
        open.delete(win);
        try {
          if (timer !== null) clearTimer(timer);
        } catch {
          // ignore
        }
        try {
          unwatch();
        } catch {
          // ignore
        }
        if (abort) {
          try {
            controller.abort();
          } catch {
            // ignore
          }
        }
        settle(decision);
      };

      let openedAt = 0;
      try {
        openedAt = now();
      } catch {
        // no clock = opened at 0
      }
      open.set(win, {
        requesterId: wcId,
        openedAt,
        cancel: () => {
          interrupted = true;
          finish('gone', true);
        }
      });
      timer = setTimer(() => finish('timeout', true), CONFIRM_TIMEOUT_MS);
      try {
        unwatch = watch(sender, win, () => finish('gone', true));
      } catch {
        finish('gone', true);
        return traced(request, await done, reason);
      }
      if (finished) return traced(request, await done, reason);

      Promise.resolve()
        .then(() => showConfirm(win, options, controller.signal))
        .then(
          (result) => {
            // An already-aborted signal resolves with no `response` key.
            const idx = result && (result.response ?? result.cancelId);
            finish(idx === AFFIRM_INDEX ? 'confirmed' : 'denied', false);
          },
          () => finish('denied', true)
        );

      const decision = await done;
      if (decision === 'gone' && interrupted && info && typeof info === 'object') info.interrupted = true;
      if (decision === 'confirmed' && grantKey !== null) {
        try {
          addGrant(wcId, grantKey, epochAtOpen);
        } catch {
          // a grant that cannot be stored just means the next request asks again
        }
      }
      return traced(request, decision, reason);
    } catch {
      return traced(request, 'denied', reason);
    }
  }

  /**
   * Would the gate apply to this sender right now (an admin session, or the document is scripted)?
   * No dialog, no state. Unreadable = applies (conservative), as in `confirm`.
   * @param {any} event
   */
  function applies(event) {
    try {
      if (hasAdminSession() === true) return true;
    } catch {
      return true;
    }
    try {
      return isTouched(event && event.sender && event.sender.id) === true;
    } catch {
      return true;
    }
  }

  /** The grant epoch (bumped by every vault lock); a handler compares it across a confirmation. */
  function epoch() {
    try {
      return grantEpoch();
    } catch {
      return 0;
    }
  }

  /**
   * The tab `wcId` is no longer in front (switched away, hidden, closed, moved): cancel its pending
   * confirmation as `gone`. Another tab's or window's confirmation is never touched; nothing pending = no-op.
   * @param {number} wcId
   */
  function tabInactive(wcId) {
    for (const entry of [...open.values()]) {
      if (entry.requesterId === wcId) entry.cancel();
    }
  }

  /**
   * Real input (a mouse press / key down, never auto-repeat, never injected - the CALLER filters those)
   * reached `win` or one of its contents while a confirmation is pending for it: the dialog is not holding
   * the window (or is not visible), so cancel it as `gone`. Ignored inside the grace period.
   * @param {any} win
   */
  function windowInput(win) {
    const entry = open.get(win);
    if (!entry) return;
    let t;
    try {
      t = now();
    } catch {
      return;
    }
    if (t - entry.openedAt < INPUT_GRACE_MS) return;
    entry.cancel();
  }

  return { confirm, applies, epoch, tabInactive, windowInput, openCount: () => open.size };
}

/**
 * Is this `input-event` payload real operator input that should cancel a pending confirmation? The payload
 * is Electron's `InputEvent` (only `type` and `modifiers`; auto-repeat is the `'isautorepeat'` modifier).
 * A press (`mouseDown`) or a key down (`rawKeyDown` / `keyDown`, not auto-repeat). Never throws.
 * @param {any} input
 * @returns {boolean}
 */
function isRevealCancelInput(input) {
  try {
    const type = input?.type;
    if (type === 'mouseDown') return true;
    if (type !== 'rawKeyDown' && type !== 'keyDown') return false;
    const mods = input.modifiers ?? [];
    return !(Array.isArray(mods) && mods.includes('isautorepeat'));
  } catch {
    return false;
  }
}

/**
 * The ONE decision shared by the chrome-view and tab-guest `input-event` listeners: event type first, then
 * "is automation injecting into this contents", then the gate call. Never throws.
 * @param {{ input: any, wcId: number, injectedInput?: { isInjecting?: (id: number) => boolean } | null, win: any, windowInput: (win: any) => void }} p
 */
function handleRevealInputEvent({ input, wcId, injectedInput, win, windowInput }) {
  try {
    if (!isRevealCancelInput(input)) return;
    if (injectedInput?.isInjecting?.(wcId)) return;
    windowInput(win);
  } catch {
    /* a listener must never throw */
  }
}

module.exports = {
  isRevealCancelInput,
  handleRevealInputEvent,
  createRevealGate,
  createDocumentMarks,
  CONFIRM_TIMEOUT_MS,
  INPUT_GRACE_MS,
  DISPLAY_MAX_CHARS,
  ACTIONS
};
