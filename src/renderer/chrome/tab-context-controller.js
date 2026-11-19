// @ts-check
// Tab context menu (M09 F5 Leg 1 / F6 Leg 3 / F8 Leg 4), extracted VERBATIM out
// of renderer.js (Mission 24 F3 Leg 3 — zero-headroom relief for the composition
// root). The `tabCtx` state, the closed-tab-stack-size and move-targets push
// caches (subscription first, then seed — as before) and `openTabContextMenu`.
// `tabCtx` is ONE object, created here and shared by identity with the overlay
// dispatch getter, the audit hooks and renderer.js's own handler.
'use strict';

/**
 * @param {{
 *   goldfinch: any,
 *   document: Document,
 *   createPushCache: <T>(initial: T) => { push: (v: T) => void, seed: (v: T) => void, get: () => T },
 *   tabContextModel: (input: any) => any,
 *   tabs: Map<string, any>,
 *   orderedTabIds: () => string[],
 *   isInternalTab: (tab: any) => boolean,
 *   openOverlayMenu: (menuType: string, model: any, anchor: any, startIndex: number, opts?: any) => void,
 *   chromePointToSheet: (cx: number, cy: number) => any
 * }} deps
 */
export function createTabContextController(deps) {
  const {
    goldfinch,
    document,
    createPushCache,
    tabContextModel,
    tabs,
    orderedTabIds,
    isInternalTab,
    openOverlayMenu,
    chromePointToSheet
  } = deps;

  /** @type {{ tabId: string | null, returnFocus: HTMLElement | null }} */
  const tabCtx = { tabId: null, returnFocus: null };

  // DD6 push-cache (M09 F6 Leg 3): the closed-tab stack's size, cached from main's
  // closed-tab-stack-changed pushes so openTabContextMenu builds its model
  // SYNCHRONOUSLY like every other sheet-menu opener. Seed/push race: a received
  // push always wins; the boot-seed invoke applies only if no push arrived first
  // (createPushCache owns the rule).
  const closedTabStackSizeCache = createPushCache(0);
  goldfinch.onClosedTabStackChanged((/** @type {any} */ d) => {
    closedTabStackSizeCache.push(d && typeof d.size === 'number' ? d.size : 0);
  });
  goldfinch
    .closedTabStackSize()
    .then((/** @type {any} */ size) => {
      closedTabStackSizeCache.seed(typeof size === 'number' ? size : 0);
    })
    .catch(() => {});

  // DD8 push-cache (M09 F8 Leg 4): the OTHER open windows, each captioned main-side
  // from its active tab's title. Same seed/push race as the stack size above.
  // Only the LABEL is cached. The windowId rides the item id and main re-resolves it
  // through the registry at dispatch, so a stale caption degrades to a wrong menu
  // word, never a move into the wrong window — DD8's windowId-over-ordinal reversal.
  const moveTargetsCache = createPushCache(/** @type {{ windowId: number, label: string }[]} */ ([]));
  goldfinch.onMoveTargetsChanged((/** @type {any} */ d) => {
    moveTargetsCache.push(Array.isArray(d?.targets) ? d.targets : []);
  });
  goldfinch
    .moveTargets()
    .then((/** @type {any} */ targets) => {
      moveTargetsCache.seed(Array.isArray(targets) ? targets : []);
    })
    .catch(() => {});

  /**
   * Open the tab context menu for `id`, anchored at `anchorEl` (chrome→sheet
   * translated element rect — the toolbar-Unpin anchor pattern). Synchronous
   * (M09 F6 Leg 3, DD6): the model reads the push-cached closed-tab stack size,
   * so a superseding open simply runs after this one.
   * @param {string} id @param {HTMLElement} anchorEl
   */
  function openTabContextMenu(id, anchorEl) {
    const ids = orderedTabIds();
    const idx = ids.indexOf(id);
    if (idx === -1) return; // vanished between event dispatch and open — no-op
    tabCtx.tabId = id;
    tabCtx.returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
    const r = anchorEl.getBoundingClientRect();
    const model = tabContextModel({
      tabId: id,
      isLastTab: ids.length <= 1,
      tabsToRight: ids.length - 1 - idx,
      stackSize: closedTabStackSizeCache.get(),
      // M09 F6 (review M4): tab:move-new-window is omitted for internal tabs —
      // app-UI pages never move between windows.
      isInternal: isInternalTab(tabs.get(id) || null),
      hasView: (tabs.get(id) || {}).wcId != null, // M16 F2 Leg 1 (DD7/DD8): no view → no dead move/duplicate controls
      // M09 F8 DD8: one flat "Move to window …" item per OTHER window. Push-cached
      // above, so this read stays synchronous.
      moveTargets: moveTargetsCache.get()
    });
    openOverlayMenu('tab-context', model, chromePointToSheet(r.left, r.bottom), 0);
  }

  return { tabCtx, openTabContextMenu };
}
