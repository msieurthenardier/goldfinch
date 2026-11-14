// @ts-check
'use strict';

// The IPC gate (Mission 23 Flight 1, leg `ipc-gate`, DD1). The ONE registration path for a
// main-process IPC channel that names a caller class. Every registrar below states WHO may
// call a channel; a call from anyone else is refused BEFORE the handler runs. The preload
// object a page can come to hold (probe Q1) is not a boundary — this main-side check is.
//
// ELECTRON-FREE, injected deps (settings-store.js / menu-overlay-manager.js shape): the live
// `ipcMain`, the window registry and a logger are passed in, so the whole module runs under
// `node --test` against fakes.
//
// Classes, each in an invoke form (`handle`) and a one-way form (`on`):
//   chrome             — the sender is some window's chrome view
//   owningChrome       — chrome, AND when the call names a tab (the registration supplies the
//                        extractor), the sender's window must own that tab. "No tab named"
//                        (null/undefined) passes as chrome-only; a tab id that IS present but
//                        not owned by the sender's window is refused — never widened.
//   chromeOrInternal   — chrome, or a trusted goldfinch:// internal page (same predicate as
//                        registerInternalHandler)
//   tabGuest           — a tab's OWN page: the sender's MAIN frame, a web tab in some window's
//                        tabViews. Three per-registration switches, each default off and each
//                        stated at the call site: `popups`, `internalTabs`, `activeOnly`. A
//                        one-way form and a synchronous form (the sync form ALWAYS answers).
//   sheet              — the window's menu-overlay sheet, AND a menu-type rule (a list, or the
//                        literals 'any-open-menu' / 'sender-only'; see ipc-channel-table.js)
//   find / savePrompt  — the window's find overlay / corner save-prompt view
//   findOrOwningChrome — the find overlay, or a window chrome (find-overlay:close)
//
// Rules the gate enforces at REGISTRATION (a throw at boot / in any unit test that builds a
// registrar): the channel is in the classification table, the registrar's class equals the
// table entry, and the channel was not registered through the gate already. An invoke-form
// registration states its refusal explicitly (`'throw'` or `{ value }`) — no default. A
// refused one-way message is dropped.
//
// The handler signature is unchanged (`(event, ...args)`), and the gate adds no asynchrony:
// a synchronous handler returns synchronously through it.
//
// Refusal trace: one line per refusal when GOLDFINCH_IPC_TRACE=1, nothing otherwise — the
// channel, the class required and the sender KIND only; never arguments, URLs or titles.

const { isTrustedInternalSender } = require('./internal-ipc');
const { CHANNEL_CLASS, SHEET_MENU_TYPES } = require('./ipc-channel-table');

/**
 * @typedef {'throw' | { value: any }} Refusal
 * @typedef {(event: any, ...args: any[]) => any} Handler
 */

/**
 * @param {{
 *   ipcMain: { handle: Function, on: Function },
 *   registry: any,
 *   logger?: { log?: Function },
 *   channelClass?: Readonly<Record<string, string>>,
 *   sheetMenuTypes?: Readonly<Record<string, 'any-open-menu' | 'sender-only' | readonly string[]>>,
 *   env?: Record<string, string | undefined>,
 *   isPopupWcId?: (id: number) => boolean
 * }} deps
 */
function createIpcGate({
  ipcMain,
  registry,
  logger = console,
  channelClass = CHANNEL_CLASS,
  sheetMenuTypes = SHEET_MENU_TYPES,
  env = process.env,
  isPopupWcId
}) {
  /** @type {Set<string>} */
  const registered = new Set();

  /**
   * The sender's window record when the sender IS a window's chrome view (identity compare);
   * a null `senderFrame` (destroyed / navigated-away frame) is refused outright.
   * @param {any} event
   */
  function requireChrome(event) {
    if (!event || !event.senderFrame) return null;
    return registry.getWindowForChrome(event.sender);
  }

  /**
   * Chrome AND owner of `wcId`: the sender's window must be the SAME record that owns the tab,
   * so window B's chrome cannot act on window A's tab by naming its id.
   * @param {any} event
   * @param {number} wcId
   */
  function ownsTab(event, wcId) {
    const rec = requireChrome(event);
    return rec && rec === registry.getWindowForGuest(wcId) ? rec : null;
  }

  /** @param {any} event */
  function isInternalSender(event) {
    if (!event || !event.senderFrame) return false;
    const origin = event.senderFrame.origin;
    const sender = event.sender;
    const isInternal = sender && sender.session ? sender.session.__goldfinchInternal : undefined;
    return isTrustedInternalSender(origin, isInternal);
  }

  /**
   * Trace-only classification of a refused sender. Never throws.
   * @param {any} event
   * @returns {'chrome' | 'tab' | 'overlay' | 'other'}
   */
  function senderKind(event) {
    try {
      const sender = event && event.sender;
      if (!sender) return 'other';
      if (registry.getWindowForChrome(sender)) return 'chrome';
      const id = sender.id;
      if (registry.getWindowForGuest(id) || (typeof isPopupWcId === 'function' && isPopupWcId(id))) return 'tab';
      if (typeof registry.recordForOverlaySender === 'function') {
        for (const key of ['sheet', 'findOverlay', 'savePrompt']) {
          if (registry.recordForOverlaySender(sender, key)) return 'overlay';
        }
      }
    } catch {
      // trace-only
    }
    return 'other';
  }

  /**
   * @param {string} channel
   * @param {string} required
   * @param {any} event
   */
  function trace(channel, required, event) {
    if (env.GOLDFINCH_IPC_TRACE !== '1') return;
    try {
      const log = logger && typeof logger.log === 'function' ? logger.log.bind(logger) : null;
      if (log) log(`[ipc-gate] refused channel=${channel} required=${required} sender=${senderKind(event)}`);
    } catch {
      // trace-only
    }
  }

  /**
   * @param {string} channel
   * @param {string} cls
   * @param {() => void} [validate]  a registration-time check run after the table checks and
   *   BEFORE the channel is marked registered (a throwing registration claims nothing)
   */
  function claim(channel, cls, validate) {
    if (typeof channel !== 'string' || !channel) throw new Error('ipc-gate: channel must be a non-empty string');
    const entry = channelClass[channel];
    if (entry === undefined) throw new Error(`ipc-gate: channel '${channel}' is not in the classification table`);
    if (entry !== cls) {
      throw new Error(`ipc-gate: channel '${channel}' is classed '${entry}' but registered as '${cls}'`);
    }
    if (registered.has(channel)) throw new Error(`ipc-gate: channel '${channel}' is already registered`);
    if (validate) validate();
    registered.add(channel);
  }

  /** @param {string} channel @param {Refusal} refusal */
  function checkRefusal(channel, refusal) {
    const ok = refusal === 'throw' || (refusal !== null && typeof refusal === 'object' && 'value' in refusal);
    if (!ok) throw new Error(`ipc-gate: '${channel}' must state its refusal ('throw' or { value })`);
  }

  /**
   * @param {string} channel
   * @param {string} cls
   * @param {(event: any, args: any[]) => boolean} allows
   * @param {Handler} handler
   * @param {Refusal} refusal
   * @param {(args: any[]) => void} [onRefuse]  runs on a refused call, before the refusal returns
   * @param {() => void} [validate]  registration-time check, run once the class check has passed
   */
  function registerInvoke(channel, cls, allows, handler, refusal, onRefuse, validate) {
    claim(channel, cls, validate);
    checkRefusal(channel, refusal);
    if (typeof handler !== 'function') throw new Error(`ipc-gate: '${channel}' needs a handler function`);
    ipcMain.handle(channel, (/** @type {any} */ event, /** @type {any[]} */ ...args) => {
      if (!allows(event, args)) {
        trace(channel, cls, event);
        if (onRefuse) {
          try {
            onRefuse(args);
          } catch {
            // best effort; the refusal still stands
          }
        }
        if (refusal === 'throw') throw new Error(`forbidden: ${cls} sender required for ${channel}`);
        return /** @type {{ value: any }} */ (refusal).value;
      }
      return handler(event, ...args);
    });
  }

  /**
   * @param {string} channel
   * @param {string} cls
   * @param {(event: any, args: any[]) => boolean} allows
   * @param {Handler} handler
   * @param {() => void} [validate]  registration-time check, run once the class check has passed
   */
  function registerOneWay(channel, cls, allows, handler, validate) {
    claim(channel, cls, validate);
    if (typeof handler !== 'function') throw new Error(`ipc-gate: '${channel}' needs a handler function`);
    ipcMain.on(channel, (/** @type {any} */ event, /** @type {any[]} */ ...args) => {
      if (!allows(event, args)) {
        trace(channel, cls, event);
        return;
      }
      handler(event, ...args);
    });
  }

  /** @type {(event: any, args: any[]) => boolean} */
  const allowsChrome = (event) => !!requireChrome(event);
  /** @type {(event: any, args: any[]) => boolean} */
  const allowsChromeOrInternal = (event) => !!requireChrome(event) || isInternalSender(event);
  /**
   * @param {(...args: any[]) => any} tabIdOf
   * @returns {(event: any, args: any[]) => boolean}
   */
  const allowsOwning = (tabIdOf) => (event, args) => {
    const rec = requireChrome(event);
    if (!rec) return false;
    let wcId;
    try {
      wcId = tabIdOf(...args);
    } catch {
      return false; // an extractor throw is a refusal, never an escape
    }
    if (wcId === null || wcId === undefined) return true;
    if (typeof wcId !== 'number') return false;
    return rec === registry.getWindowForGuest(wcId);
  };

  // --- tab-guest ------------------------------------------------------------------------

  /** @type {readonly string[]} */
  const TAB_GUEST_SWITCHES = ['popups', 'internalTabs', 'activeOnly'];

  /**
   * @param {string} channel
   * @param {any} sw
   * @returns {{ popups: boolean, internalTabs: boolean, activeOnly: boolean }}
   */
  function checkSwitches(channel, sw) {
    if (!sw || typeof sw !== 'object' || Array.isArray(sw)) {
      throw new Error(`ipc-gate: '${channel}' must state its tab-guest switches ({} when none)`);
    }
    for (const key of Object.keys(sw)) {
      if (!TAB_GUEST_SWITCHES.includes(key))
        throw new Error(`ipc-gate: '${channel}' unknown tab-guest switch '${key}'`);
      if (typeof sw[key] !== 'boolean') throw new Error(`ipc-gate: '${channel}' switch '${key}' must be a boolean`);
    }
    return { popups: sw.popups === true, internalTabs: sw.internalTabs === true, activeOnly: sw.activeOnly === true };
  }

  /**
   * True only when `event.senderFrame` IS the sender's main frame, compared by frame-tree
   * node id inside a try (a disposed frame can throw). Never `parent === null`, which is also
   * true for a frame no longer in the tree. Fail-closed when either side is absent.
   * @param {any} event
   */
  function isMainFrameSender(event) {
    try {
      const frame = event && event.senderFrame;
      const main = event && event.sender && event.sender.mainFrame;
      if (!frame || !main) return false;
      const a = frame.frameTreeNodeId;
      const b = main.frameTreeNodeId;
      return typeof a === 'number' && a === b;
    } catch {
      return false;
    }
  }

  /**
   * @param {{ popups: boolean, internalTabs: boolean, activeOnly: boolean }} sw
   * @returns {(event: any, args: any[]) => boolean}
   */
  const allowsTabGuest = (sw) => (event) => {
    try {
      if (!event || !event.sender || !isMainFrameSender(event)) return false;
      const id = event.sender.id;
      const rec = registry.getWindowForGuest(id);
      if (rec) {
        const entry = rec.tabViews && typeof rec.tabViews.get === 'function' ? rec.tabViews.get(id) : null;
        if (entry && entry.trusted === true && !sw.internalTabs) return false;
        if (sw.activeOnly && rec.activeTabWcId !== id) return false;
        return true;
      }
      return sw.popups && !sw.activeOnly && typeof isPopupWcId === 'function' && isPopupWcId(id) === true;
    } catch {
      return false;
    }
  };

  /**
   * The synchronous form: a refused, throwing or allowed call ALL set `event.returnValue`, so
   * the sending renderer (a page load blocks on it) is never left waiting.
   * @param {string} channel
   * @param {any} sw
   * @param {Handler} handler
   * @param {{ value: any } | { produce: () => any }} refusal
   */
  function registerTabGuestSync(channel, sw, handler, refusal) {
    const switches = checkSwitches(channel, sw);
    const ok =
      refusal !== null &&
      typeof refusal === 'object' &&
      ('value' in refusal || typeof (/** @type {any} */ (refusal).produce) === 'function');
    if (!ok) throw new Error(`ipc-gate: '${channel}' must state its refusal value ({ value } or { produce })`);
    if (typeof handler !== 'function') throw new Error(`ipc-gate: '${channel}' needs a handler function`);
    claim(channel, 'tab-guest');
    const allows = allowsTabGuest(switches);
    const refuse = () => ('produce' in refusal ? refusal.produce() : /** @type {any} */ (refusal).value);
    ipcMain.on(channel, (/** @type {any} */ event, /** @type {any[]} */ ...args) => {
      let result;
      if (!allows(event, args)) {
        trace(channel, 'tab-guest', event);
        result = refuse();
      } else {
        try {
          result = handler(event, ...args);
        } catch {
          result = refuse();
        }
      }
      event.returnValue = result;
    });
  }

  // --- overlay views (sheet / find / save-prompt) -----------------------------------------

  /**
   * @param {any} event
   * @param {string} key  'sheet' | 'findOverlay' | 'savePrompt'
   */
  function overlayRecord(event, key) {
    if (!event || !event.senderFrame || !event.sender) return null;
    if (typeof registry.recordForOverlaySender !== 'function') return null;
    return registry.recordForOverlaySender(event.sender, key);
  }

  /** @param {string} key @returns {(event: any, args: any[]) => boolean} */
  const allowsOverlay = (key) => (event) => !!overlayRecord(event, key);

  /**
   * @param {string} channel
   * @param {any} menuTypes
   * @returns {'any-open-menu' | 'sender-only' | readonly string[]}
   */
  function checkMenuTypes(channel, menuTypes) {
    if (menuTypes === 'any-open-menu' || menuTypes === 'sender-only') return menuTypes;
    if (
      Array.isArray(menuTypes) &&
      menuTypes.length > 0 &&
      menuTypes.every((t) => typeof t === 'string' && t.length > 0)
    ) {
      return menuTypes;
    }
    throw new Error(
      `ipc-gate: '${channel}' must state its sheet menu types (a non-empty list, 'any-open-menu' or 'sender-only')`
    );
  }

  /**
   * The registration's menu-type rule must equal the table's row (one list, one place).
   * @param {string} channel
   * @param {'any-open-menu' | 'sender-only' | readonly string[]} menuTypes
   */
  function checkAgainstTable(channel, menuTypes) {
    const row = sheetMenuTypes[channel];
    if (row === undefined) throw new Error(`ipc-gate: sheet channel '${channel}' has no row in the menu-type table`);
    if (JSON.stringify(row) !== JSON.stringify(menuTypes)) {
      throw new Error(`ipc-gate: sheet channel '${channel}' menu types differ from the table row`);
    }
  }

  /**
   * @param {string} channel
   * @param {'any-open-menu' | 'sender-only' | readonly string[]} menuTypes
   * @returns {(event: any, args: any[]) => boolean}
   */
  const allowsSheet = (channel, menuTypes) => (event) => {
    const rec = overlayRecord(event, 'sheet');
    if (!rec || !rec.sheet) return false;
    if (menuTypes === 'sender-only') return true;
    try {
      const current = typeof rec.sheet.getCurrentMenu === 'function' ? rec.sheet.getCurrentMenu() : null;
      if (!current) return false;
      return menuTypes === 'any-open-menu' || menuTypes.includes(current.menuType);
    } catch {
      return false;
    }
  };

  /**
   * A refused sheet invoke zeroes any byte array its payload carried, as the allowed path's
   * own `finally` does: the secret never lingers in main because the call was turned away.
   * @param {any[]} args
   */
  function zeroTransferred(args) {
    for (const arg of args) {
      if (arg instanceof Uint8Array) {
        arg.fill(0);
      } else if (arg && typeof arg === 'object') {
        for (const key of Object.keys(arg)) {
          const v = arg[key];
          if (v instanceof Uint8Array) v.fill(0);
        }
      }
    }
  }

  // --- find-or-owning-chrome ---------------------------------------------------------------

  /** @type {(event: any, args: any[]) => boolean} */
  const allowsFindOrChrome = (event) => !!overlayRecord(event, 'findOverlay') || !!requireChrome(event);

  /** @param {Function} tabIdOf @param {string} channel */
  const needExtractor = (tabIdOf, channel) => {
    if (typeof tabIdOf !== 'function') throw new Error(`ipc-gate: '${channel}' needs a tab-id extractor`);
  };

  return {
    requireChrome,
    ownsTab,
    chrome: {
      /** @param {string} channel @param {Handler} handler @param {Refusal} refusal */
      handle: (channel, handler, refusal) => registerInvoke(channel, 'chrome', allowsChrome, handler, refusal),
      /** @param {string} channel @param {Handler} handler */
      on: (channel, handler) => registerOneWay(channel, 'chrome', allowsChrome, handler)
    },
    owningChrome: {
      /** @param {string} channel @param {(...args: any[]) => any} tabIdOf @param {Handler} handler @param {Refusal} refusal */
      handle: (channel, tabIdOf, handler, refusal) => {
        needExtractor(tabIdOf, channel);
        registerInvoke(channel, 'owning-chrome', allowsOwning(tabIdOf), handler, refusal);
      },
      /** @param {string} channel @param {(...args: any[]) => any} tabIdOf @param {Handler} handler */
      on: (channel, tabIdOf, handler) => {
        needExtractor(tabIdOf, channel);
        registerOneWay(channel, 'owning-chrome', allowsOwning(tabIdOf), handler);
      }
    },
    chromeOrInternal: {
      /** @param {string} channel @param {Handler} handler @param {Refusal} refusal */
      handle: (channel, handler, refusal) =>
        registerInvoke(channel, 'chrome-or-internal', allowsChromeOrInternal, handler, refusal),
      /** @param {string} channel @param {Handler} handler */
      on: (channel, handler) => registerOneWay(channel, 'chrome-or-internal', allowsChromeOrInternal, handler)
    },
    tabGuest: {
      /** @param {string} channel @param {{ popups?: boolean, internalTabs?: boolean, activeOnly?: boolean }} sw @param {Handler} handler */
      on: (channel, sw, handler) =>
        registerOneWay(channel, 'tab-guest', allowsTabGuest(checkSwitches(channel, sw)), handler),
      /** @param {string} channel @param {{ popups?: boolean, internalTabs?: boolean, activeOnly?: boolean }} sw @param {Handler} handler @param {{ value: any } | { produce: () => any }} refusal */
      sync: (channel, sw, handler, refusal) => registerTabGuestSync(channel, sw, handler, refusal)
    },
    sheet: {
      /** @param {string} channel @param {any} menuTypes @param {Handler} handler @param {Refusal} refusal */
      handle: (channel, menuTypes, handler, refusal) => {
        /** @type {any} */
        let types;
        registerInvoke(
          channel,
          'sheet',
          (event, args) => allowsSheet(channel, types)(event, args),
          handler,
          refusal,
          zeroTransferred,
          () => {
            types = checkMenuTypes(channel, menuTypes);
            checkAgainstTable(channel, types);
          }
        );
      },
      /** @param {string} channel @param {any} menuTypes @param {Handler} handler */
      on: (channel, menuTypes, handler) => {
        /** @type {any} */
        let types;
        registerOneWay(
          channel,
          'sheet',
          (event, args) => allowsSheet(channel, types)(event, args),
          handler,
          () => {
            types = checkMenuTypes(channel, menuTypes);
            checkAgainstTable(channel, types);
          }
        );
      }
    },
    find: {
      /** @param {string} channel @param {Handler} handler */
      on: (channel, handler) => registerOneWay(channel, 'find', allowsOverlay('findOverlay'), handler)
    },
    savePrompt: {
      /** @param {string} channel @param {Handler} handler @param {Refusal} refusal */
      handle: (channel, handler, refusal) =>
        registerInvoke(channel, 'save-prompt', allowsOverlay('savePrompt'), handler, refusal),
      /** @param {string} channel @param {Handler} handler */
      on: (channel, handler) => registerOneWay(channel, 'save-prompt', allowsOverlay('savePrompt'), handler)
    },
    findOrOwningChrome: {
      /** @param {string} channel @param {Handler} handler */
      on: (channel, handler) => registerOneWay(channel, 'find-or-owning-chrome', allowsFindOrChrome, handler)
    }
  };
}

module.exports = { createIpcGate };
