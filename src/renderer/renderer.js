/* Goldfinch browser UI controller: tabs, navigation, and the media panel. */

// ES module (M07 Flight 2 leg 5): shared dependencies are explicit imports.
// index.html is a file:// document, so the specifiers are disk-true relative
// paths — no serving-path mismatch, no @ts-ignore needed (unlike the two
// internal pages' flat-served imports). The evaluate-reachable seam at the
// BOTTOM of this file republishes the automation/dogfooding entry points that
// module scoping would otherwise hide.
import { BURNER } from '../shared/burner.js';
import { buildContainerModel } from '../shared/container-menu.js';
import { buildAutomationIndicatorModel } from '../shared/automation-indicator-model.js';
import { isSafeColor } from '../shared/safe-color.js';
import { isSafeTabUrl, isSafePosterUrl, isInternalPageUrl } from '../shared/url-safety.js';
import { keydownToAction } from '../shared/keydown-action.js';
import { deriveSiteInfo } from '../shared/site-info.js';
import { pageContextModel } from '../shared/page-context-model.js';
import { tabContextModel } from '../shared/tab-context-model.js';
import { resolveNewTabContainer } from '../shared/default-routing.js';
import { inheritContainerDecision, inheritFromPartition } from '../shared/inherit-container.js';
import { shouldQuery, buildSuggestionModel, moveSelection, acceptSuggestResponse } from '../shared/omnibox-suggest-model.js';
import { keyboardMove } from '../shared/tab-order.js';
import { classifyDragPoint } from '../shared/tab-drag-zone.js'; // the drag's reorder/tear-off zone decision (pure, window-local)
import { createPushCache } from '../shared/push-cache.js';
import { resolveRestoreContainer } from '../shared/restore-container.js'; // M09 F9 / DD4: saved jarId → live jar, or null (drop)
import { createChromeContext } from './chrome/context.js';
import { createJarsClient } from './chrome/jars-client.js';
import { createTabController } from './chrome/tab-controller.js';
import {
  buildKebabModel,
  chromePointToSheet as convertChromePointToSheet,
  createOverlayMenus,
  fixedTriggerMenu,
  leftSheetAnchor,
  rightSheetAnchor
} from './chrome/overlay-menus.js';

const HOMEPAGE = 'https://www.google.com';
let homePageCache = HOMEPAGE;
function currentHomePage() { return homePageCache || HOMEPAGE; }

const ctx = createChromeContext({ document, goldfinch: window.goldfinch });
const { els, tabs } = ctx;

/**
 * @typedef {{
 *   id: string,
 *   webview: Electron.WebviewTag | null,
 *   trusted: boolean,
 *   title: string,
 *   url: string,
 *   favicon: string | null,
 *   media: any[],
 *   selected: Set<string>,
 *   wcId: number | null,
 *   privacy: { net: any, fp: { canvas: number, webgl: number, audio: number }, permissions: any[], cookies: any },
 *   container: { id: string, name: string, color: string, partition: string, burner?: boolean },
 *   btn?: HTMLElement,
 *   findOpen?: boolean,
 *   findText?: string
 * }} Tab
 */

let tabController;
const jarsClient = createJarsClient({
  bridge: window.goldfinch,
  ctx,
  burner: BURNER,
  isWebTab: (tab) => tabController.isWebTab(tab),
  isInternalTab: (tab) => tabController.isInternalTab(tab),
  activateTab: (id) => tabController.activateTab(id),
  closeTab: (id) => tabController.closeTab(id),
  updateAutomationIndicator,
  getAutomationSnapshot: () => lastSnap,
  inheritContainerDecision,
  inheritFromPartition,
  random: Math.random
});

tabController = createTabController({
  window,
  document,
  requestAnimationFrame,
  ResizeObserver,
  ctx,
  els,
  tabs,
  jarsClient,
  blankPrivacy,
  escapeHtml,
  openTabContextMenu: (id, anchorEl) => openTabContextMenu(id, anchorEl),
  currentHomePage,
  isInternalPageUrl,
  isSafeTabUrl,
  resolveNewTabContainer,
  classifyDragPoint,
  announceTabStatus,
  updateNavButtons,
  refreshZoomControl,
  fetchCookies,
  closeSuggestions,
  resetSuggestionsForActivation,
  updateAddressChip,
  renderMedia,
  renderPrivacy,
  setDevtoolsPressed
});

const {
  createTab,
  closeTab,
  activateTab,
  activeTab,
  findTabByWcId,
  isInternalTab,
  isWebTab,
  orderedTabIds,
  commitTabMove,
  moveOutcomeMessage,
  releaseTabWidths,
  measureWebviewsSlotDIP,
  sendActiveBounds
} = tabController;

// Preserve the FD-approved evaluate seam's stable callable name while the
// implementation and its mutable jar state live in the extracted client.
function makeBurner() {
  return jarsClient.makeBurner();
}
/* ------------------------------------------------------- kebab (overflow) menu */
// APG menu-button: role="menu" popup with six static role="menuitem" items
// (New window, Settings, Downloads, Cookie jars, Print…, Exit) + roving tabindex
// + arrow-nav. Count and order track `kebabModel` below — the single source of
// truth; if you add an item there, this line is stale until you edit it too.
//
// All menus render from the menu-overlay SHEET (M05 F8, DD4 model-over-IPC):
// chrome keeps the trigger, open stimuli, model building, and action execution;
// the sheet is presentation-only. The pre-F8 chrome-DOM menus and their
// freeze-frame apparatus were retired at the Leg-5 cutover.

// The kebab item actions, extracted into NAMED functions consumed by the
// sheet's channel-6 activation — one source of truth (Exit is verified by this
// shared body, never activated live).
// New Window (M09 F6 Leg 4, DD5): the same body Ctrl/Cmd+N dispatches through
// dispatchChromeAction('new-window') — main creates the window; its chrome
// document boots a home tab normally (window-boot-config bootTab:true).
function kebabActionNewWindow() {
  window.goldfinch.windowCreate();
}
function kebabActionSettings() {
  createTab('goldfinch://settings', null, { trusted: true });
}
function kebabActionDownloads() {
  openDownloads();
}
function kebabActionJars() {
  openJarsPage();
}
function kebabActionPrint() {
  const t = activeTab();
  if (t && !isInternalTab(t) && t.wcId != null) window.goldfinch.print({ webContentsId: t.wcId });
}
function kebabActionExit() {
  window.goldfinch.appQuit();
}
/** @type {{ [id: string]: () => void }} */
const KEBAB_ACTIONS = {
  'new-window': kebabActionNewWindow,
  settings: kebabActionSettings,
  downloads: kebabActionDownloads,
  jars: kebabActionJars,
  print: kebabActionPrint,
  exit: kebabActionExit
};

/* ---- kebab (and every menu below) over the menu-overlay sheet (DD4 protocol) ---- */

// Chrome-minted monotonic open-token, carried in channel 1 and echoed in
// channels 4/5/7 — the stale-close discipline (round-2 design lock). Shared
// across menu types (all five surfaces mint from the same counter).
const overlayMenus = {
  kebab: fixedTriggerMenu(() => els.kebab),
  container: fixedTriggerMenu(() => els.newTabMenu),
  'site-info': fixedTriggerMenu(() => els.addressChip),
  'new-container': fixedTriggerMenu(() => els.newTabMenu),
  'page-context': {
    open: false, token: 0, blurClosedAt: -Infinity, ariaTarget: () => null,
    refocus(reason) {
      const ret = pageCtx.returnFocus;
      pageCtx.returnFocus = null;
      if (reason !== 'escape') return;
      if (ret && ret.isConnected && ret !== document.body && typeof ret.focus === 'function') ret.focus();
      else els.address.focus();
    }
  },
  'tab-context': {
    open: false, token: 0, blurClosedAt: -Infinity, ariaTarget: () => null,
    refocus(reason) {
      const ret = tabCtx.returnFocus;
      tabCtx.returnFocus = null;
      if (reason !== 'escape') return;
      if (ret && ret.isConnected && ret !== document.body && typeof ret.focus === 'function') ret.focus();
      else els.address.focus();
    }
  },
  suggestions: {
    open: false, token: 0, blurClosedAt: -Infinity,
    ariaTarget: () => els.address,
    refocus() {}
  }
};
const overlayMenuClient = createOverlayMenus({
  bridge: window.goldfinch,
  states: overlayMenus,
  now: () => performance.now(),
  onActivated: dispatchOverlayActivation,
  onClosed: handleOverlayClosed
});

// Static kebab model — labels rendered via textContent in the sheet (DD8).
// New window first (Chrome adjacency: window/tab creation ahead of app pages).
// DD2 anchor nuance: the kebab's anchor is a CHROME client rect — translate
// chrome→sheet by subtracting the guest-region origin (#webviews). y clamps to 0
// (DD12): the menu renders right-aligned, flush at the sheet's top edge (the
// accepted ~4px shift).
const kebabAnchor = () => {
  const wv = els.webviews.getBoundingClientRect();
  const r = els.kebab.getBoundingClientRect();
  return rightSheetAnchor(wv, r);
};
// Left-aligned toolbar anchors (Leg 3 — ▾ and 🔒): same chrome→sheet translation,
// LEFT edge, clamped ≥ 0; y clamps to 0 (DD12 flush-at-top, the accepted shift).
/** @param {HTMLElement} el */
const leftAnchorOf = (el) => {
  const wv = els.webviews.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return leftSheetAnchor(wv, r);
};
const containerAnchor = () => leftAnchorOf(els.newTabMenu);
const siteInfoAnchor = () => leftAnchorOf(els.addressChip);

// Generic channel-1 open (Leg 3): mint token, mark open, send, set aria.
// Mutual exclusion is main's model-replace (channel 7 'superseded' for the
// outgoing menuType) — no chrome-side menu state exists to close.
// `opts` (M08 Flight 4 Leg 3): an optional bag merged into the Ch1 payload —
// today only `{ noFocus }` (the suggestions controller's non-focusing open,
// DD2). Every existing caller omits it and is unaffected (merges nothing).
/** @param {string} menuType @param {any} model @param {any} anchor
 *  @param {number} startIndex 0 = first item; -1 = last (trigger ArrowUp)
 *  @param {{ noFocus?: boolean }} [opts] */
const openOverlayMenu = overlayMenuClient.open;

/** @param {number} startIndex */
const openKebabOverlay = (startIndex) => openOverlayMenu('kebab', buildKebabModel(), kebabAnchor(), startIndex);
// Container model rebuilt per-open from the `containers` array (no runtime
// jar-list refresh exists in the product); namespaced ids via the shared
// buildContainerModel (src/shared/container-menu.js).
/** @param {number} startIndex */
const openContainerOverlay = (startIndex) =>
  openOverlayMenu('container', buildContainerModel(jarsClient.containers, jarsClient.defaultId), containerAnchor(), startIndex);
// Site-info model derived from the active tab via the shared deriveSiteInfo
// (the one derivation source). startIndex is meaningless for the no-items
// popup — the sheet focuses the "Site settings →" action.
const openSiteInfoOverlay = () => openOverlayMenu('site-info', siteInfoModel(activeTab()), siteInfoAnchor(), 0);
// New-container dialog (AC4): the template ignores the anchor (centered via CSS)
// but the open path stays uniform (fresh token, aria on the ▾ refocus trigger).
const openNewContainerOverlay = () => openOverlayMenu('new-container', [], containerAnchor(), 0);
// Page-context sheet opener (Leg 4). The four invocation sites (guest
// right-click subscription, chrome-focused keyboard, toolbar-unpin, audit hook)
// live further down; they capture pageCtx FIRST, then call with a POINT anchor:
// guest params.x/y ride 1:1 (DD2 payoff — sheet CSS coords ≡ guest-region DIPs,
// no els.webviews offset translation on that path); the chrome-anchored modes
// (keyboard / toolbar / audit) pass chrome→sheet-translated points. The model is
// built from the captured params by the pure shared builder; toolbar mode passes
// pageCtx.toolbarItem.
/** @param {{ x: number, y: number }} anchor */
const openPageContextOverlaySheet = (anchor) =>
  openOverlayMenu('page-context', pageContextModel(pageCtx.params, pageCtx.toolbarItem), anchor, 0);

// Generic trigger-click toggle (kebab pattern, Leg-3 shared): open → channel-2
// 'toggle' close (the sheet's blur usually resolves the close first — see the
// suppress window; when the click wins the race this is the explicit close, no
// focus move: the physical click already OS-focused chrome). Closed → suppress
// the same-menuType RE-OPEN within 300 ms of a blur-reason close (DD4 trigger
// re-click race: mousedown blurred the sheet → dismissed{blur} → channel 7 reset
// open-state BEFORE this click fired); other menus' triggers are unaffected
// (same-menuType-only — composes with mutual exclusion).
/** @param {string} menuType @param {() => void} openFn */
const overlayTriggerClick = overlayMenuClient.trigger;

els.kebab.addEventListener('click', () => overlayTriggerClick('kebab', () => openKebabOverlay(0)));

// Trigger keydown (APG menu-button): Enter/Space/ArrowDown → open to first item,
// ArrowUp → open to last (startIndex −1). preventDefault suppresses the synthetic
// click. Deliberately NO suppress window here — a keyboard re-open immediately
// after a stale close must work (the token discipline covers that race).
els.kebab.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault();
    openKebabOverlay(0);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    openKebabOverlay(-1);
  }
});

// ▾ container-picker trigger (Leg 3): click toggle + APG menu-button keydown —
// mirrors the kebab pair exactly.
els.newTabMenu.addEventListener('click', () => overlayTriggerClick('container', () => openContainerOverlay(0)));
els.newTabMenu.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault();
    openContainerOverlay(0);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    openContainerOverlay(-1);
  }
});

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

// Channel 6: execute the activated item's action via the named action bodies /
// shared helpers (one source of truth). Arrives AFTER
// the channel-7 'activated' close (main emits 7 before 6), so trigger state is
// already reset and the action wins any focus race. `value` (Leg 3) is the
// input-dialog's text — shape-validated main-side (string, ≤24), data here.
function dispatchOverlayActivation({ menuType, id, value }) {
  switch (menuType) {
    case 'kebab': {
      const fn = KEBAB_ACTIONS[id];
      if (fn) fn();
      break;
    }
    case 'container': {
      // NAMESPACED id dispatch (round-2 design catch): `jar:<jarId>` selects
      // that jar — even one literally named "New Container" (slug id
      // `new-container`) or "Burner"; sentinels ride the `action:` prefix, so
      // a user jar can never shadow them.
      if (id === 'action:new-container') {
        // Activated-close-then-fresh-open (design decision): main already
        // closed the container menu (reason 'activated' — the normal channel-4
        // path); immediately re-open menuType 'new-container' as a FRESH open
        // through the same path as any trigger open (new token; uniform
        // suppress/aria bookkeeping). The one-IPC-round-trip hide/re-show
        // blink is the accepted variation.
        openNewContainerOverlay();
      } else if (id === 'action:burner') {
        createTab(currentHomePage(), jarsClient.makeBurner());
      } else if (id === 'action:manage-jars') {
        openJarsPage();
      } else if (id.startsWith('jar:')) {
        const jarId = id.slice('jar:'.length);
        const c = jarsClient.containers.find((x) => x.id === jarId);
        if (c) createTab(currentHomePage(), c);
      }
      break;
    }
    case 'site-info': {
      if (id === 'site-settings') openSiteSettingsTab();
      break;
    }
    case 'new-container': {
      // Shared submit body (the old dialog's create path, extracted): trim
      // guard + newContainerCreate → push + createTab. The sheet page already
      // guards whitespace-only input (dialog stays open page-side).
      if (id === 'create') createContainerAndOpenTab(value);
      break;
    }
    case 'page-context': {
      // Bodies read the pageCtx fields CAPTURED at open (TOCTOU: acted-on
      // wcId is never re-resolved via activeTab()). VALIDATED-NO-OP discipline
      // on EVERY id (design review): a synchronous local open can overwrite
      // pageCtx between channel 7 and channel 6, and params can be gone by
      // dispatch time (tab closed) — each body re-guards its inputs and never
      // throws on a stale dispatch (main-side handlers already tolerate dead
      // wcId targets).
      const p = pageCtx.params || {};
      const wcId = pageCtx.wcId;
      // D3 (M06 F2 HAT): link/image/selection-search opens inherit the SOURCE
      // tab's jar (inheritContainerFrom, defined near makeBurner) instead of
      // createTab's default-jar resolution — computed once here (all three
      // call sites below are mutually exclusive per dispatch; the source tab
      // never changes mid-dispatch, so one lookup covers all three bodies).
      const srcContainer = jarsClient.inheritContainerFrom(findTabByWcId(wcId));
      if (id === 'link:open') {
        if (typeof p.linkURL === 'string' && p.linkURL) createTab(p.linkURL, srcContainer);
      } else if (id === 'link:copy') {
        if (typeof p.linkURL === 'string' && p.linkURL) window.goldfinch.clipboardWriteText(p.linkURL);
      } else if (id === 'image:open' || id === 'image:copy' || id === 'image:save') {
        // Same srcURL || imageURL preference + mediaType gate as the builder.
        const imgSrc = p.mediaType === 'image' ? (p.srcURL || p.imageURL) : null;
        if (typeof imgSrc === 'string' && imgSrc) {
          if (id === 'image:open') {
            createTab(imgSrc, srcContainer);
          } else if (id === 'image:copy') {
            window.goldfinch.clipboardWriteText(imgSrc);
          } else {
            const r = window.goldfinch.downloadMedia({
              webContentsId: wcId,
              url: imgSrc,
              suggestedName: basenameFromUrl(imgSrc)
            });
            Promise.resolve(r).then((res) => {
              if (!res || !res.ok) toast('Download failed', (res && res.error) || 'Unknown error');
            }).catch(() => toast('Download failed', 'Unknown error'));
          }
        }
      } else if (id === 'sel:copy') {
        if (typeof p.selectionText === 'string' && p.selectionText) {
          window.goldfinch.clipboardWriteText(p.selectionText);
        }
      } else if (id === 'sel:search') {
        if (typeof p.selectionText === 'string' && p.selectionText) createTab(toUrl(p.selectionText), srcContainer);
      } else if (id.startsWith('edit:')) {
        // Allowlisted edit-action dispatch (main re-validates the allowlist too).
        // Also re-check the captured editFlags that gated menu construction
        // (page-context-model.js: canCut/canCopy/canPaste/canUndo/canRedo).
        const action = id.slice('edit:'.length);
        const flagKey = 'can' + action.charAt(0).toUpperCase() + action.slice(1);
        if (
          p.isEditable &&
          ['cut', 'copy', 'paste', 'undo', 'redo'].includes(action) &&
          p.editFlags && p.editFlags[/** @type {'canCut'|'canCopy'|'canPaste'|'canUndo'|'canRedo'} */ (flagKey)]
        ) {
          window.goldfinch.pageContextAction({ webContentsId: wcId, action });
        }
      } else if (id.startsWith('spell:')) {
        // INDEX dispatch (DD8): the id carries only the index; the word resolves
        // from the CAPTURED suggestions with bounds/type validation — a guest
        // string never round-trips as a command. Out-of-range / malformed /
        // params-gone → validated no-op.
        const i = Number.parseInt(id.slice('spell:'.length), 10);
        const sugg = p.dictionarySuggestions;
        if (
          Number.isInteger(i) && i >= 0 &&
          Array.isArray(sugg) && i < Math.min(sugg.length, 8) &&
          typeof sugg[i] === 'string'
        ) {
          window.goldfinch.correctMisspelling({ webContentsId: wcId, word: sugg[i] });
        }
      } else if (id === 'action:inspect') {
        if (wcId != null) window.goldfinch.toggleDevtools({ webContentsId: wcId });
      } else if (id.startsWith('action:unpin:')) {
        const item = id.slice('action:unpin:'.length);
        if (item === 'media' || item === 'shields' || item === 'devtools') {
          window.goldfinch.unpinToolbarItem(item);
          // Dispatch-body refocus: the unpin hides the button the menu was
          // anchored to — land focus on the address bar. NOT the reason map
          // (page-context stays escape-only).
          els.address.focus();
        }
      }
      break;
    }
    case 'tab-context': {
      // TOCTOU discipline (design review, same pattern as page-context above):
      // the tab id is captured at OPEN (tabCtx.tabId), never re-resolved via
      // activeTab(); every body re-validates the tab still exists via tabs.get
      // and no-ops (never throws) on a vanished id.
      const tabId = tabCtx.tabId;
      const target = tabId ? tabs.get(tabId) : null;
      if (id === 'tab:close') {
        if (target) closeTab(tabId);
      } else if (id === 'tab:close-others' || id === 'tab:close-right') {
        if (!target) break;
        // Ordered-sweep batch close (flight DD2 ruling — the onJarWiped/
        // refreshOpenTabJars activation-flicker idiom): snapshot the targets
        // BEFORE any close mutates the strip, activate the ANCHOR (the invoking
        // tab) FIRST when the active tab is among the targets (Chrome parity —
        // the anchor becomes active), THEN close each target. Activating first
        // means none of the targets is still the active tab by the time
        // closeTab runs on it, so closeTab's own next-tab fallback never fires
        // mid-sweep — never let it cascade.
        const ids = orderedTabIds();
        const anchorIndex = ids.indexOf(tabId);
        if (anchorIndex === -1) break; // vanished — no-op
        const targetIds = id === 'tab:close-others'
          ? ids.filter((i) => i !== tabId)
          : ids.slice(anchorIndex + 1);
        if (!targetIds.length) break;
        if (targetIds.includes(ctx.activeTabId)) activateTab(tabId);
        for (const t of targetIds) closeTab(t);
      } else if (id === 'tab:duplicate') {
        // Address + jar + nav history (DD1's resolved open question): the
        // history-snapshot invoke + createTab with restoreHistory + insertAt
        // sourceIndex+1 (Chrome parity — lands beside the source). Title is
        // seeded from the renderer's OWN tab.title — no round-trip through main.
        if (!target || target.wcId == null) break;
        const sourceContainer = target.container;
        const sourceTitle = target.title;
        const sourceUrl = target.url;
        window.goldfinch.tabHistorySnapshot({ webContentsId: target.wcId }).then((snap) => {
          if (!snap) return; // internal/dead source by the time the invoke resolved — no-op
          // sourceIndex is computed AND used here, synchronously at resolve time
          // (M09 F6 Leg 3, DD6 — the F5 staleness sibling: capturing it BEFORE
          // the invoke could misplace the duplicate if the strip mutated during
          // the round-trip). A source that vanished mid-invoke (-1) appends.
          const sourceIndex = orderedTabIds().indexOf(tabId);
          createTab(sourceUrl, sourceContainer, {
            restoreHistory: { entries: snap.entries, index: snap.index, title: sourceTitle },
            insertAt: sourceIndex === -1 ? null : sourceIndex + 1
          });
        });
      } else if (id === 'tab:move-new-window') {
        // Move to new window (M09 F6 Leg 4, DD5 / review H2): the invoke
        // carries THIS renderer's strip snapshot — a burner's synthesized
        // container and the favicon exist ONLY renderer-side; main cannot
        // rebuild either from the wcId (it re-derives url/title itself at
        // adopt-send time). Validated no-op on a vanished/wcId-less target;
        // the strip removal arrives via the tab-moved-away push, never done
        // locally (main is the executor).
        if (!target || target.wcId == null) break;
        window.goldfinch.tabMoveToNewWindow({
          wcId: target.wcId,
          url: target.url,
          title: target.title,
          favicon: target.favicon,
          container: target.container
        });
      } else if (id.startsWith('tab:move-window:')) {
        // Move to an EXISTING window (M09 F8 Leg 4, DD8) — the tab's only way
        // across windows in F8. Same strip snapshot as the new-window path above,
        // plus the destination.
        //
        // The windowId is ECHOED from the item id main built it into — never a
        // position in the current list, which is exactly what the reversed ordinal
        // scheme would have sent. Re-reading it here rather than re-deriving it
        // from moveTargetsCache is the point: the cache may have been re-pushed
        // since the menu opened, and this move means the window the USER picked.
        // Main re-resolves the id through the registry and REFUSES if that window
        // has closed (DD5) rather than re-pointing at a survivor.
        if (!target || target.wcId == null) break;
        const windowId = Number(id.slice('tab:move-window:'.length));
        if (!Number.isInteger(windowId)) break;
        window.goldfinch.tabMoveToWindow({
          wcId: target.wcId,
          url: target.url,
          title: target.title,
          favicon: target.favicon,
          container: target.container,
          windowId
        }).then((result) => {
          // DD5: every outcome is announced. On success `tab-moved-away` has
          // already removed the strip entry, so this is all that is left either way.
          announceTabStatus(moveOutcomeMessage(result, 'another window'));
        });
      } else if (id === 'tab:reopen-closed') {
        // The EXISTING dispatchChromeAction('reopen-closed-tab') case (dispatch
        // reuse, DD2) — its jar-fallback/positional-reopen decisions ride along
        // free. Deliberately NOT gated on `target`: reopen acts on the closed-tab
        // stack, not the invoking tab, which may itself have vanished by now.
        dispatchChromeAction('reopen-closed-tab');
      }
      break;
    }
    case 'suggestions': {
      // INDEX dispatch (the spell:<i> idiom): the id carries only the row
      // index; the URL resolves from `suggest.items`, which channel 7 (just
      // above, fired before this) deliberately left intact for exactly this
      // read on the 'activated' reason. Vanished/mismatched (e.g. a tab switch
      // raced the click and bumped suggest.seq, invalidating suggest.items in
      // between) → no-op, never throw.
      const m = /^sug:(\d+)$/.exec(id);
      const i = m ? Number(m[1]) : -1;
      const item = Number.isInteger(i) && i >= 0 ? suggest.items[i] : undefined;
      if (item && typeof item.url === 'string' && item.url) navigate(item.url);
      resetSuggestState(); // finishes the reset channel 7 deferred for 'activated'
      break;
    }
  }
}

// Channel 7: the single close-state sink. Stale tokens (a re-open raced an old
// instance's close) are dropped WHOLE — a stale close must not clear the newer
// open's state (and, for page-context, must not consume the newer open's
// returnFocus). aria-expanded resets on EVERY (non-stale) reason — guarded on
// ariaTarget() (null for page-context, whose transient trigger is never
// stamped). Refocus is the per-entry reason policy (chrome-side half — main
// already moved webContents-level focus for escape/activated): fixed-trigger
// menus focus the trigger on escape/activated; page-context is escape-only →
// the captured returnFocus (cleared after use). toggle → no move (the click
// already focused chrome); blur → NO refocus (never steal focus from another
// app); tab-switch/superseded/tab-close/tab-hide/teardown → no move (the
// incoming guest keeps focus).
function handleOverlayClosed({ menuType, reason }) {
  // Suggestions branch (design review, HIGH): main-initiated closes (window
  // blur, tab-switch, etc.) reach the sheet WITHOUT going through
  // closeSuggestions() — this is the only place those reset local state, so
  // every NON-STALE suggestions close resets it here too. Timers are ALWAYS
  // cancelled (incl. 'activated' — this is what lets a real Ch6 activation win
  // the pointer-blur grace-timer race: the timer must die the instant the row
  // click's close lands, not 150 ms later). items/selectedIndex are the
  // EXCEPTION on 'activated': channel 7 (this handler) fires strictly BEFORE
  // channel 6 for the same activation (main emits 7 then 6 — round-2 design
  // lock), so the Ch6 `sug:<i>` dispatch below still needs `suggest.items` to
  // resolve the clicked row's URL. Ch6 finishes the reset once it has read it.
  if (menuType === 'suggestions') {
    cancelSuggestTimers();
    if (reason !== 'activated') {
      suggest.items = [];
      suggest.selectedIndex = -1;
    }
  }
}

/* ------------------------------------------------------- container picker */
// The ▾ picker renders menuType 'container' from the sheet (trigger wiring
// above, with the kebab); the model is rebuilt per-open from the `containers`
// array. The new-container dialog is the sheet's input-dialog template
// (menuType 'new-container') — it replaced the old chrome dialog at cutover.

// Shared open path for downloads (DD2): kebab downloads item + both Ctrl+J paths converge here.
function openDownloads() {
  createTab('goldfinch://downloads', null, { trusted: true });
}

// Shared open path for the jars page (Leg 3): kebab "Cookie jars" item + the
// picker's "Manage jars…" sentinel both converge here. Mirrors openDownloads'
// SHAPE and its dedupe semantics — openDownloads has no dedupe/reuse guard (it
// unconditionally creates; repeated opens already stack Downloads tabs today), so
// this opener does the same, unconditionally. Parity, not an enhancement — do not
// add dedupe logic here.
function openJarsPage() {
  createTab('goldfinch://jars', null, { trusted: true });
}

/* ------------------------------------------------------- site-info popup */
// The 🔒 chip renders menuType 'site-info' from the sheet (trigger wiring
// above); the sheet's info-popup template supplies Escape/Tab dismissal. The
// model derives from the shared deriveSiteInfo (src/shared/site-info.js) —
// the one derivation source. DD5/DD7.

/** Caller-resolved internal flag for deriveSiteInfo (isInternalTab/isInternalPageUrl
 * live with the chrome's tab state, not in the shared module).
 * @param {Tab|null} tab */
function siteInfoInternalFlag(tab) {
  return !!tab && (isInternalTab(tab) || isInternalPageUrl(tab.url));
}

/** "Site settings →" destination — the channel-6 'site-settings' activation body
 * (extracted, Leg 3). */
function openSiteSettingsTab() {
  const existing = [...tabs.values()].find(isInternalTab);
  if (existing && existing.wcId != null) {
    // Internal tab is now a WebContentsView (Leg 3); navigate via tab-navigate IPC.
    window.goldfinch.tabNavigate({ wcId: existing.wcId, verb: 'loadURL', args: ['goldfinch://settings/#privacy'] });
    activateTab(existing.id);
  } else if (existing) {
    // wcId not yet arrived; just activate the tab (it will load at its original URL).
    activateTab(existing.id);
  } else {
    createTab('goldfinch://settings/#privacy', null, { trusted: true });
  }
}

/** Sheet info-popup template model: note/row/action items derived from the
 * active tab's state. All strings are DATA — the sheet renders via textContent
 * only (DD8).
 * @param {Tab|null} tab */
function siteInfoModel(tab) {
  const info = deriveSiteInfo(tab, siteInfoInternalFlag(tab));
  // `=== true` (not truthiness): narrows the discriminated union under this
  // project's strictNullChecks-off typecheck config.
  if (info.internal === true) return [{ type: 'note', variant: 'secure', text: info.note }];
  return [
    { type: 'note', variant: 'host', text: info.host },
    { type: 'row', label: 'Connection', value: info.connection },
    { type: 'row', label: 'Trackers blocked', value: String(info.trackers) },
    { type: 'row', label: 'Permissions', value: String(info.permissions) },
    { type: 'action', id: 'site-settings', label: 'Site settings →' }
  ];
}

/* ------------------------------------------------- page context menu (SC6/DD2/DD3) */
// The custom web-content context menu, rendered from the sheet (menuType
// 'page-context', point-anchored). It subscribes to onPageContextMenu IPC
// ({ wcId, params }) forwarded from the guest's main-side context-menu listener
// (internal goldfinch:// guests auto-excluded main-side, DD6). The model is built
// per-invocation from the forwarded params by the pure shared pageContextModel;
// focus-return rides the per-entry refocus policy (escape-only → returnFocus).

// Module-scoped state: the LAST forwarded { wcId, params } and the focus-return
// target captured at open. Acted-on wcId is the one captured at right-click
// (TOCTOU — never re-resolved via activeTab() for dispatch).
/** @type {{ wcId: number|null, params: any, returnFocus: HTMLElement|null, toolbarItem: ('media'|'shields'|'devtools'|null) }} */
const pageCtx = { wcId: null, params: null, returnFocus: null,
  toolbarItem: null };  // 'media' | 'shields' | 'devtools' | null  (null = page-content mode)

/** Derive a download filename from a media URL's basename (mirrors media-panel naming). */
function basenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || u.hostname || 'image';
  } catch {
    return 'image';
  }
}

/** Chrome client coords → sheet CSS point (the DD2 nuance for the
 * chrome-anchored invocation modes: keyboard, toolbar-unpin, audit hook): subtract
 * the guest-region origin; y clamps ≥ 0 (an anchor above the guest region renders
 * flush at the sheet's top edge). The guest right-click path does NOT come through
 * here — its params.x/y are already sheet coords, 1:1 (DD2 payoff).
 * @param {number} cx @param {number} cy @returns {{ x: number, y: number }} */
function chromePointToSheet(cx, cy) {
  const wv = els.webviews.getBoundingClientRect();
  return convertChromePointToSheet(wv, cx, cy);
}

// Subscription: the guest right-click flows guest -> main -> this IPC ({ wcId, params }).
// Store state + focus-return, then open menuType 'page-context' on the sheet AT
// params.x/y DIRECTLY — guest-view-relative DIPs ≡ sheet-page CSS coords (DD2
// 1:1 identity; NO els.webviews offset translation on this path).
window.goldfinch.onPageContextMenu(({ wcId, params }) => {
  pageCtx.wcId = wcId;
  pageCtx.params = params;
  pageCtx.toolbarItem = null;
  pageCtx.returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  openPageContextOverlaySheet({
    x: (params && typeof params.x === 'number') ? params.x : 0,
    y: (params && typeof params.y === 'number') ? params.y : 0
  }); // 1:1 — no translation
});

// Shift+F10 / ContextMenu key — chrome-focused case. When focus is INSIDE the guest
// WebContentsView, Chromium synthesizes a real context-menu event on the guest webContents,
// which flows through main's listener and the onPageContextMenu subscription above.
// This handler only covers the CHROME-focused case (toolbar/chrome element focus).
document.addEventListener('keydown', (e) => {
  const isContextKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
  if (!isContextKey) return;
  if (!els.lightbox.classList.contains('hidden')) return;
  const target = /** @type {HTMLElement|null} */ (document.activeElement);
  if (!target || target === document.body) return;
  // Gate: toolbar pin buttons fire both contextmenu AND this keydown — the contextmenu
  // listener already opens the toolbar Unpin menu; return early here to avoid double-firing.
  if (target === els.toggleMedia || target === els.togglePrivacy || target === els.toggleDevtools) return;
  // Gate (M09 F5 Leg 1, DD2 integration point): a focused tab fires both a native
  // `contextmenu` event (handled by the tab's own listener, wired at creation —
  // opens the TAB menu) AND this generic keydown — same double-fire shape as the
  // toolbar pins above. Return early so a focused tab never ALSO opens the
  // generic Inspect-only menu; no parallel keydown listener is added for tabs.
  if (target.closest('.tab')) return;
  e.preventDefault();
  const r = target.getBoundingClientRect();
  pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
  pageCtx.params = null;
  pageCtx.toolbarItem = null;
  pageCtx.returnFocus = target;
  // Chrome-anchored mode: translate the element-rect point chrome→sheet (the
  // DD2 nuance — only the guest right-click path rides 1:1).
  openPageContextOverlaySheet(chromePointToSheet(r.left, r.bottom));
});

/**
 * Toolbar-mode invocation: right-click a pinned toolbar icon to get a single "Unpin {item}"
 * item, anchored at the clicked button (menuType 'page-context', toolbar short-circuit).
 * @param {'media'|'shields'|'devtools'} item
 * @param {HTMLElement} anchorEl  the toolbar button that was right-clicked
 */
function openToolbarContextMenu(item, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  pageCtx.toolbarItem = item;
  pageCtx.params = null;
  pageCtx.wcId = null;
  pageCtx.returnFocus = anchorEl;
  // Toolbar-mode on the sheet: the model short-circuits to the single Unpin
  // item (pageCtx.toolbarItem); translated element anchor (chrome→sheet).
  openPageContextOverlaySheet(chromePointToSheet(r.left, r.bottom));
}

/**
 * Test/audit hook: open the page context menu with a representative synthetic params payload
 * so the `npm run a11y` harness can audit the open sheet menu. Builds a full-section
 * menu (link + selection + editable + spelling-suggestions + Inspect) at a fixed chrome coord.
 * Reachable via the MCP evaluate tool (published by the evaluate-reachable seam
 * at the bottom of this file — module scope hides top-level functions).
 */
function openPageContextMenuForAudit() {
  pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
  pageCtx.params = {
    linkURL: 'https://example.com/',
    selectionText: 'sample',
    isEditable: true,
    editFlags: { canCut: true, canCopy: true, canPaste: true, canUndo: true, canRedo: true },
    misspelledWord: 'teh',
    dictionarySuggestions: ['the', 'ten', 'tea'],
    x: 80,
    y: 80
  };
  pageCtx.toolbarItem = null;
  pageCtx.returnFocus = els.address;
  // The synthetic 80,80 CHROME coords are translated chrome→sheet like the other
  // keyboard-mode anchors — immaterial to the audit's purpose, pinned for determinism.
  openPageContextOverlaySheet(chromePointToSheet(80, 80));
}

/* ------------------------------------------------ tab context menu (M09 F5 Leg 1) */
// Tab-scoped context menu, rendered from the sheet (menuType 'tab-context',
// element-anchored like the toolbar Unpin menu — DD2). ONE trigger listener
// covers BOTH invocation paths: a real right-click AND the Context-Menu-key /
// Shift+F10 on a focused tab both fire the native DOM `contextmenu` event at the
// focused/targeted element (the same fact the toolbar pin buttons already rely
// on — see their own `contextmenu` listeners + the keydown catch-all's exclusion
// gate below, extended here for `.tab`). No parallel keydown listener is added
// (DD2 integration-point ruling).

/** @type {{ tabId: string | null, returnFocus: HTMLElement | null }} */
const tabCtx = { tabId: null, returnFocus: null };

// DD6 push-cache (M09 F6 Leg 3): the closed-tab stack's size, cached from main's
// closed-tab-stack-changed pushes so openTabContextMenu builds its model
// SYNCHRONOUSLY like every other sheet-menu opener — the F5 async opener, its
// cross-type stale-resolve edge, and the tabCtx.tabId re-check guard are all
// deleted with the await. Seed/push race: a received push always wins; the
// boot-seed invoke applies only if no push arrived first (createPushCache owns
// the rule — the push is the fresher fact even when the numbers disagree).
const closedTabStackSizeCache = createPushCache(0);
window.goldfinch.onClosedTabStackChanged((d) => {
  closedTabStackSizeCache.push(d && typeof d.size === 'number' ? d.size : 0);
});
window.goldfinch.closedTabStackSize().then((size) => {
  closedTabStackSizeCache.seed(typeof size === 'number' ? size : 0);
});

// DD8 push-cache (M09 F8 Leg 4): the OTHER open windows, each captioned main-side
// from its active tab's title. Same seed/push race as the stack size above, and
// cached for the same reason — openTabContextMenu is SYNCHRONOUS and F6 DD6
// deleted the async opener (and its stale-resolve guard) it would otherwise need.
// Only the LABEL is cached. The windowId rides the item id and main re-resolves it
// through the registry at dispatch, so a stale caption degrades to a wrong menu
// word, never a move into the wrong window — DD8's windowId-over-ordinal reversal.
const moveTargetsCache = createPushCache(/** @type {{ windowId: number, label: string }[]} */ ([]));
window.goldfinch.onMoveTargetsChanged((d) => {
  moveTargetsCache.push(Array.isArray(d?.targets) ? d.targets : []);
});
window.goldfinch.moveTargets().then((targets) => {
  moveTargetsCache.seed(Array.isArray(targets) ? targets : []);
});

/**
 * Open the tab context menu for `id`, anchored at `anchorEl` (chrome→sheet
 * translated element rect — the toolbar-Unpin anchor pattern). Synchronous
 * (M09 F6 Leg 3, DD6): the model reads the push-cached closed-tab stack size,
 * so a superseding open simply runs after this one — no in-flight resolve to
 * guard against.
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
    // M09 F8 DD8: one flat "Move to window …" item per OTHER window. Push-cached
    // above, so this read stays synchronous.
    moveTargets: moveTargetsCache.get()
  });
  openOverlayMenu('tab-context', model, chromePointToSheet(r.left, r.bottom), 0);
}

/**
 * Test/audit hook: open the tab context menu with a REPRESENTATIVE synthetic
 * model (bypassing the live orderedTabIds()/stack-size-cache reads that
 * openTabContextMenu makes, exactly the way openPageContextMenuForAudit
 * bypasses the live guest params) — items-to-right and a non-empty stack so all
 * five items render, per the a11y checkpoint. Anchored at the first tab if one
 * exists, else the tab strip itself. Reachable via the MCP evaluate tool
 * (closed-set seam at the bottom of this file — FD-ruled addition, flight DD).
 *
 * The synthetic moveTargets (M09 F8 Leg 4) is the point of the word REPRESENTATIVE:
 * the live cache is empty in a one-window app, so an audit that read it would render
 * no "Move to window …" item and report clean on a menu MISSING the item type leg 4
 * added. The audit must exercise the shape it is auditing.
 */
function openTabContextMenuForAudit() {
  const ids = orderedTabIds();
  const id = ids[0] || null;
  const anchorEl = (id && tabs.get(id) && tabs.get(id).btn) || els.tabs;
  tabCtx.tabId = id;
  tabCtx.returnFocus = els.address;
  const r = anchorEl.getBoundingClientRect();
  // isInternal:false — representative synthetic model with EVERY item rendered
  // (seven since M09 F8: tab:move-new-window — F6 — plus one tab:move-window:<id>),
  // per the a11y checkpoint.
  const moveTargets = [{ windowId: 0, label: 'Another window' }];
  const model = tabContextModel({ tabId: id || 'audit', isLastTab: false, tabsToRight: 1, stackSize: 1, isInternal: false, moveTargets });
  openOverlayMenu('tab-context', model, chromePointToSheet(r.left, r.bottom), 0);
}

/* ------------------------------------------------------------------ tabs */

/**
 * Update the address-bar chip and read-only state from the given tab.
 * Called from every address-sync site (activateTab, onNav, did-navigate-in-page).
 * @param {Tab|null} tab
 */
function updateAddressChip(tab) {
  const chip = els.addressChip;
  const url = tab && tab.url;

  if (!url || url === 'about:blank') {
    // Neutral default: new/blank tab — web state with generic label
    chip.removeAttribute('data-state');
    chip.removeAttribute('data-secure');
    chip.setAttribute('aria-label', 'Site information');
    els.address.readOnly = false;
    return;
  }

  if (isInternalPageUrl(url)) {
    chip.setAttribute('data-state', 'internal');
    chip.removeAttribute('data-secure');
    chip.setAttribute('aria-label', 'Secure Goldfinch page');
    els.address.readOnly = true;
    return;
  }

  // Web tab: parse the host for the label; guard against unparseable URLs
  let host;
  try {
    host = new URL(url).host;
  } catch {
    // Unparseable URL — fall back to neutral default
    chip.removeAttribute('data-state');
    chip.removeAttribute('data-secure');
    chip.setAttribute('aria-label', 'Site information');
    els.address.readOnly = false;
    return;
  }
  const secure = /^https:/i.test(url);
  chip.setAttribute('data-state', 'web');
  chip.setAttribute('data-secure', secure ? 'true' : 'false');
  chip.setAttribute('aria-label', host
    ? (secure ? `Site information, ${host}` : `Site information, ${host}, not secure`)
    : 'Site information');
  els.address.readOnly = false;
}


function updateNavButtons() {
  const tab = activeTab();
  if (!tab) { els.back.disabled = true; els.forward.disabled = true; return; }
  if (isInternalTab(tab)) {
    // Internal tabs never have navigation history — disable both buttons explicitly.
    // (No webview to query; tab-nav-state IPC is not sent for internal views.)
    els.back.disabled = true;
    els.forward.disabled = true;
  }
  // For web tabs: nav state is pushed via onTabNavState; buttons stay at last known state
}

/* ---------------------------------------------------------------- navigation */

function navigate(input) {
  const tab = activeTab();
  if (!tab) return;
  const url = toUrl(input);
  // Internal-tab navigation lock (DD6): after toUrl resolution, check whether the
  // active tab is an internal (goldfinch://) tab. If so, reroute any web URL to a
  // new normal tab and leave the internal tab untouched. The address bar is readOnly,
  // so real user entry here is belt-and-suspenders (the bar's readOnly prevents
  // direct user input, but navigate() could theoretically be invoked programmatically).
  if (isInternalTab(tab)) {
    if (!isInternalPageUrl(url)) {
      createTab(url); // open web URL in a NEW normal tab (untrusted/web branch)
    }
    // Whether the URL was internal (belt-and-suspenders no-op) or web (rerouted above),
    // never free-navigate the internal tab via the address bar.
    return;
  }
  // Internal tabs are handled by the isInternalTab early-return above; only web tabs reach here.
  if (isWebTab(tab) && tab.wcId != null) {
    window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'loadURL', args: [url] });
  }
}

function toUrl(input) {
  const s = input.trim();
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith('about:')) return s;
  // Looks like a domain? (has a dot, no spaces)
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/* ------------------------------------------------------- omnibox suggestions */
// Suggestions controller (M08 Flight 4 Leg 3 / flight DD5): chrome-owned
// state, combobox-like. The pure decision module
// (../shared/omnibox-suggest-model.js) holds the query gate, model building,
// selection clamping, and the response-time revalidation gate — this block
// only wires events (renderer.js growth discipline). `overlayMenus.suggestions`
// (registered above, with the other menu entries) is the SINGLE SOURCE OF
// TRUTH for open/closed (design review Q3 ruling) — no local `open` flag here.
const SUGGEST_DEBOUNCE_MS = 100;
const SUGGEST_BLUR_GRACE_MS = 150;
const suggest = { seq: 0, items: [], selectedIndex: -1, graceTimer: null, debounceTimer: null, lastQuery: '' };

function cancelSuggestTimers() {
  if (suggest.graceTimer) { clearTimeout(suggest.graceTimer); suggest.graceTimer = null; }
  if (suggest.debounceTimer) { clearTimeout(suggest.debounceTimer); suggest.debounceTimer = null; }
}

// Full local-state reset — cancels both timers and clears the painted rows/
// selection. Called by closeSuggestions() (every chrome-initiated close),
// the Ch7 sink above (every main-initiated close, plus the tail of an
// 'activated' close once Ch6 has read `suggest.items`), and activateTab
// (tab-switch invalidation).
function resetSuggestState() {
  cancelSuggestTimers();
  suggest.items = [];
  suggest.selectedIndex = -1;
}

function resetSuggestionsForActivation() {
  suggest.seq++;
  resetSuggestState();
}

// The query-gate snapshot for the CURRENT moment — shared by the input
// listener's initial gate and the response-time revalidation gate
// (acceptSuggestResponse). Burner/internal tabs never query (structural).
function suggestGateNow() {
  const tab = activeTab();
  return shouldQuery({
    focused: document.activeElement === els.address,
    isInternal: isInternalTab(tab),
    isBurner: !!(tab && tab.container && tab.container.burner),
    value: els.address.value
  });
}

// Close helper: no-op unless open (reads the single source of truth); sends
// the channel-2 close, then resets local state immediately — the async Ch7
// round-trip will also reset it (idempotent), but this avoids a visible
// stale-row flash while it's in flight.
/** @param {'escape' | 'blur' | 'navigation' | 'input-empty' | 'activated'} reason */
function closeSuggestions(reason) {
  if (!overlayMenus.suggestions.open) return;
  overlayMenuClient.close(reason);
  resetSuggestState();
}

// Address-bar left edge, sheet-translated — the same leftAnchorOf idiom the
// ▾ and 🔒 triggers use; y:0 (flush at the sheet top, DD12).
const suggestAnchor = () => leftAnchorOf(els.address);

// Paint (or re-paint on selection move) suggest.items/selectedIndex as a
// model-replace — always noFocus (DD2): keyboard/programmatic updates never
// move OS focus off #address.
function paintSuggestions() {
  const model = buildSuggestionModel(suggest.items, suggest.selectedIndex);
  openOverlayMenu('suggestions', model, suggestAnchor(), 0, { noFocus: true });
}

// Select-all on first click into a populated, non-readOnly address bar
// (browser convention — Ruling R1, HAT step 2): a mousedown that is what's
// FOCUSING the input (not already the active element) preventDefault()s the
// default cursor-placement and programmatically focus()+select()s instead.
// A second click while already focused falls through to normal cursor
// placement. readOnly (internal goldfinch:// tabs) is left alone entirely.
// Mirrors the existing Ctrl+L (`focus-address`) focus()+select() pair.
els.address.addEventListener('mousedown', (e) => {
  if (els.address.readOnly) return; // internal tabs: leave alone
  if (document.activeElement === els.address) return; // already focused → normal cursor placement
  e.preventDefault();
  els.address.focus();
  els.address.select();
});

// Query gate + 100 ms debounce + token/seq guard. `{ok:false}` responses close
// if open, never throw.
els.address.addEventListener('input', () => {
  cancelSuggestTimers();
  const value = els.address.value;
  if (value.trim() === '') {
    closeSuggestions('input-empty'); // close trigger: input emptied
    return;
  }
  if (!suggestGateNow()) return; // not focused / internal / burner tab — never query
  suggest.debounceTimer = setTimeout(() => {
    suggest.debounceTimer = null;
    const tab = activeTab();
    if (!tab) return;
    const requestSeq = ++suggest.seq;
    suggest.lastQuery = value;
    window.goldfinch.historySuggest({ jarId: tab.container.id, query: value }).then((res) => {
      // Response-time gate revalidation (flight DD5 HIGH, the kebab-while-
      // typing race): a stale response must never model-replace a menu the
      // operator opened meanwhile.
      const gateNow = suggestGateNow();
      if (!acceptSuggestResponse({ requestSeq, currentSeq: suggest.seq, gateNow })) return;
      if (!res || res.ok !== true) {
        closeSuggestions('input-empty');
        return;
      }
      suggest.items = Array.isArray(res.suggestions) ? res.suggestions : [];
      suggest.selectedIndex = -1;
      paintSuggestions();
    }).catch(() => {
      if (acceptSuggestResponse({ requestSeq, currentSeq: suggest.seq, gateNow: suggestGateNow() })) closeSuggestions('input-empty');
    });
  }, SUGGEST_DEBOUNCE_MS);
});

// Close trigger: address blur — a 150 ms grace timer (design review, HIGH):
// a pointer click on a sheet row moves OS focus to the sheet BEFORE the row's
// Ch4 activation lands at main, racing this blur; the grace window lets Ch6
// win the race (the Ch7 sink above cancels this timer the instant the real
// 'activated' close arrives). The callback re-checks BOTH the captured token
// (a newer suggestions session opened within the window must not be closed by
// the stale timer) AND document.activeElement (the operator came back —
// retype, the in-bar zoom buttons, Ctrl+L — none of which mint a new token).
els.address.addEventListener('blur', () => {
  if (!overlayMenus.suggestions.open) return;
  const tokenAtBlur = overlayMenus.suggestions.token;
  if (suggest.graceTimer) clearTimeout(suggest.graceTimer);
  suggest.graceTimer = setTimeout(() => {
    suggest.graceTimer = null;
    if (overlayMenus.suggestions.token !== tokenAtBlur) return; // a newer session opened within the window
    if (document.activeElement === els.address) return; // the operator came back
    closeSuggestions('blur');
  }, SUGGEST_BLUR_GRACE_MS);
});

// The existing lone Enter handler grows (leg contract) to cover the full
// keyboard contract: ArrowDown/ArrowUp move the selection and re-open
// (model-replace, still noFocus); Enter with a selection navigates it; Enter
// without one is the EXISTING behavior, byte-identical; Escape closes without
// moving focus/clearing text.
els.address.addEventListener('keydown', (e) => {
  const open = overlayMenus.suggestions.open;
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    suggest.selectedIndex = moveSelection(suggest.selectedIndex, e.key === 'ArrowDown' ? 1 : -1, suggest.items.length);
    paintSuggestions();
    return;
  }
  if (open && e.key === 'Escape') {
    e.preventDefault(); // input keeps focus and text
    closeSuggestions('escape');
    return;
  }
  if (e.key === 'Enter') {
    if (open && suggest.selectedIndex >= 0 && suggest.items[suggest.selectedIndex]) {
      const item = suggest.items[suggest.selectedIndex];
      closeSuggestions('activated');
      navigate(item.url);
      els.address.blur();
      return;
    }
    // Existing behavior — byte-identical when no suggestion is selected.
    navigate(els.address.value);
    els.address.blur();
  }
});
els.back.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  // Internal tabs have back disabled; web tabs use the view IPC path.
  if (isWebTab(t) && t.wcId != null) { window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'goBack', args: [] }); }
});
els.forward.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  // Internal tabs have forward disabled; web tabs use the view IPC path.
  if (isWebTab(t) && t.wcId != null) { window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'goForward', args: [] }); }
});
els.reload.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  // Internal tabs: reload button is not wired (no navigation history to stop/reload).
  if (isWebTab(t) && t.wcId != null) {
    if (els.reload.textContent === '✕') window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'stop', args: [] });
    else window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
  }
});
els.newTab.addEventListener('click', () => createTab());
// The ▾ container-picker toggle is registered with its own gate branch (Leg 3):
// gate OFF in the container-picker section (chrome-DOM menu), gate ON in the
// menu-overlay sheet branch (menuType 'container').

// --- custom window controls (win+linux frameless; hidden on macOS) ---
els.winMin.addEventListener('click', () => window.goldfinch.windowMinimize());
els.winMax.addEventListener('click', () => window.goldfinch.windowToggleMaximize());
els.winClose.addEventListener('click', () => window.goldfinch.windowClose());
function setMaximized(isMax) {
  els.winMax.setAttribute('data-state', isMax ? 'maximized' : 'normal');
  els.winMax.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
  els.winMax.title = isMax ? 'Restore' : 'Maximize';
  // Icon is drawn in CSS keyed off data-state (normal=square, maximized=restore pair);
  // no textContent so the CSS pseudo-element glyphs aren't clobbered.
}
window.goldfinch.windowIsMaximized().then(setMaximized);
window.goldfinch.onWindowMaximizedChange(setMaximized);

function focusTab(id) {
  const t = tabs.get(id);
  if (t && t.btn) /** @type {HTMLElement} */ (t.btn).focus();
}
// announceTabStatus (M09 F2 DD3): transient sr-only status announcement for tab-strip
// actions, mirroring the existing #media-status idiom on its own dedicated region so
// tab announcements never race media-panel ones.
function announceTabStatus(text) {
  els.tabStatus.textContent = text;
}
els.tabs.addEventListener('keydown', (e) => {
  // DD1: DOM order is authoritative for the strip's keyboard contract.
  const ids = orderedTabIds();
  if (!ids.length) return;
  // Cast the closest() RESULT (Element|null) to HTMLElement so `.dataset` typechecks —
  // `.closest()` returns Element regardless of receiver, and `.dataset` is HTMLElement-only.
  const cur = /** @type {HTMLElement|null} */ (document.activeElement?.closest('.tab'))?.dataset.id || ctx.activeTabId;

  // Reorder (M09 F2 DD3): Ctrl+Shift+ArrowLeft/Right moves the FOCUSED tab one slot.
  // Checked BEFORE the plain-arrow branch below so a modified arrow never falls
  // through to select-and-focus navigation; same no-hijack scoping as the rest of
  // this handler (it only runs when focus is inside the strip). Selection
  // (aria-selected) is untouched — only the focused tab's DOM position moves, and it
  // may not be the active tab (Edge Cases: focused tab ≠ active tab).
  if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    releaseTabWidths(); // keyboard reorder always reflows immediately (DD5 parity with Delete)
    const direction = e.key === 'ArrowRight' ? 'right' : 'left';
    const moved = keyboardMove(ids, cur, direction);
    if (moved !== ids) {
      const targetIndex = moved.indexOf(cur);
      commitTabMove(cur, targetIndex);
      focusTab(cur);
      announceTabStatus(`Tab moved to position ${targetIndex + 1} of ${moved.length}`);
    }
    // At an end (or a single tab), keyboardMove no-ops silently — no announcement.
    return;
  }

  const idx = Math.max(0, ids.indexOf(cur));
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const next = ids[(idx + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    activateTab(next);
    focusTab(next);
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const next = e.key === 'Home' ? ids[0] : ids[ids.length - 1];
    activateTab(next);
    focusTab(next);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    releaseTabWidths(); // keyboard close always reflows immediately (DD5) — clears any active freeze
    closeTab(cur);
    const now = activeTab();
    if (now && now.btn) focusTab(now.id);
  }
});

/* --------------------------------------------------------------- media panel */

function togglePanel(force) {
  const collapsed = els.panel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  els.panel.classList.toggle('collapsed', !show);
  els.toggleMedia.classList.toggle('active', show);
  els.toggleMedia.setAttribute('aria-expanded', String(show));
  if (show) {
    closePrivacyPanel(); // only one right-side panel at a time
    els.mediaClose.focus(); // only move focus when actually opening
  } else if (els.panel.contains(document.activeElement)) {
    // Closing while focus is inside the (now zero-width) panel would strand it:
    // restore focus to the toggle. Guard avoids stealing focus on programmatic
    // closes where focus isn't in the panel (e.g. opening the privacy panel).
    // Focus-restoration guard: if the button is unpinned (hidden), .focus() is a
    // silent no-op that strands focus on <body> — fall back to the address bar.
    if (!els.toggleMedia.classList.contains('hidden')) els.toggleMedia.focus();
    else els.address.focus();
  }
}
els.toggleMedia.addEventListener('click', () => { togglePanel(); sendActiveBounds(); });
els.toggleMedia.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('media', els.toggleMedia); });
els.mediaClose.addEventListener('click', () => { togglePanel(false); sendActiveBounds(); });
// Non-modal: Escape closes the media panel; togglePanel restores focus to the toggle.
els.panel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePanel(false);
    sendActiveBounds();
  }
});
els.mediaRescan.addEventListener('click', () => {
  const t = activeTab();
  // Internal tabs are excluded by the disabled button state (tab-scoped toolbar disable).
  if (!t || t.wcId == null || isInternalTab(t)) return;
  window.goldfinch.rescanMedia({ wcId: t.wcId });
});

els.filters.forEach((f) =>
  f.addEventListener('click', () => {
    els.filters.forEach((x) => {
      const isActive = x === f;
      x.classList.toggle('active', isActive);
      // Non-color cue (WCAG 1.4.1): expose the active filter to AT via aria-pressed.
      x.setAttribute('aria-pressed', String(isActive));
    });
    ctx.activeFilter = f.dataset.filter;
    renderMedia();
  })
);

// Items currently shown in the panel, honoring the active filter.
function visibleItems() {
  const media = (activeTab() && activeTab().media) || [];
  return ctx.activeFilter === 'all' ? media : media.filter((m) => m.type === ctx.activeFilter);
}

function renderMedia() {
  const tab = activeTab();
  const media = (tab && tab.media) || [];
  const filtered = visibleItems();

  els.mediaCount.textContent = media.length ? String(media.length) : '';
  els.mediaCount.classList.toggle('hidden', !media.length);
  els.toggleMedia.setAttribute('aria-label', media.length ? 'Media, ' + media.length + ' items' : 'Media');
  els.mediaList.innerHTML = '';
  els.mediaEmpty.classList.toggle('hidden', filtered.length > 0);
  els.mediaStatus.textContent = filtered.length
    ? `${filtered.length} media item${filtered.length === 1 ? '' : 's'}`
    : 'No media on this page';

  for (const item of filtered) els.mediaList.appendChild(mediaCard(item, tab));
  updateDownloadSelected();
}

function mediaCard(item, tab) {
  const card = document.createElement('div');
  card.className = 'media-card';
  card.dataset.url = item.url;

  const thumb = document.createElement('div');
  thumb.className = 'media-thumb';

  // Top-left overlay: selection checkbox (downloadable items only) + type badge.
  const pick = document.createElement('label');
  pick.className = 'media-pick';
  if (item.type !== 'embed') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    // Unique, descriptive name per item (the wrapping <label> only carries the
    // type badge, so this gives AT a distinguishable name for each checkbox).
    cb.setAttribute('aria-label', `Select ${item.label || item.name}`);
    cb.checked = tab.selected.has(item.url);
    if (cb.checked) card.classList.add('selected');
    pick.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) tab.selected.add(item.url);
      else tab.selected.delete(item.url);
      card.classList.toggle('selected', cb.checked);
      updateDownloadSelected();
    });
    pick.appendChild(cb);
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.type;
  pick.appendChild(badge);
  thumb.appendChild(pick);

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.url;
    img.alt = item.label || item.name || '';
    thumb.appendChild(img);
    thumb.title = 'Open in viewer';
    thumb.addEventListener('click', () => openLightbox(item));
  } else if (item.type === 'video') {
    if (isSafePosterUrl(item.poster)) thumb.style.backgroundImage = `url("${item.poster}")`;
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">▶</span>`);
    thumb.title = 'Play here';
    thumb.addEventListener('click', () => playInline(item, thumb));
  } else if (item.type === 'audio') {
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">♪</span>`);
    thumb.title = 'Play in player';
    thumb.addEventListener('click', () => playAudio(item));
    if (player.url === item.url) card.classList.add('playing');
  } else {
    // embed
    thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">⧉</span>`);
    thumb.title = 'Open in new tab';
    thumb.addEventListener('click', () => popout(item));
  }
  card.appendChild(thumb);

  const meta = document.createElement('div');
  meta.className = 'media-meta';
  const dims = item.width && item.height ? `${item.width}×${item.height}` : '';
  const primary = item.label || item.name;
  const secondary = item.label && item.name !== item.label ? item.name : dims;
  meta.innerHTML =
    `<div class="media-name">${escapeHtml(primary)}</div>` +
    (secondary ? `<div class="media-dims">${escapeHtml(secondary)}</div>` : '');
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'media-actions';

  // Audio plays in the docked player; video plays inline in its card.
  if (item.type === 'audio') actions.appendChild(iconBtn('▶', 'Play', () => playAudio(item)));
  else if (item.type === 'video') actions.appendChild(iconBtn('▶', 'Play here', () => playInline(item, thumb)));

  // Every item gets a pop-out: images -> zoomable viewer, AV -> full-size tab.
  actions.appendChild(
    iconBtn('↗', item.type === 'image' ? 'Open in viewer' : 'Pop out to new tab', () => popout(item))
  );

  // Download (everything except non-fetchable embeds).
  if (item.type !== 'embed') {
    const dl = iconBtn('⇩', 'Download', () => downloadItem(item, tab));
    dl.classList.add('primary');
    actions.appendChild(dl);
  }
  card.appendChild(actions);
  return card;
}

function iconBtn(glyph, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-action';
  b.textContent = glyph;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

// Swap a video/audio card's thumbnail for a live, playing player in place.
function playInline(item, thumb) {
  if (thumb.dataset.playing === '1') return;
  thumb.dataset.playing = '1';
  thumb.style.cursor = 'default';
  thumb.style.backgroundImage = 'none';
  thumb.classList.add(item.type === 'audio' ? 'audio-live' : 'video-live');
  thumb.innerHTML = `<label class="media-pick"><span class="badge">${item.type}</span></label>`;
  const player = document.createElement(item.type === 'video' ? 'video' : 'audio');
  player.src = item.url;
  player.controls = true;
  player.autoplay = true;
  player.className = 'inline-player';
  thumb.appendChild(player);
}

// Pop a media item out of the panel into its best full view.
function popout(item) {
  if (item.type === 'image') {
    openLightbox(item);
    return;
  }
  createTab(item.url); // video / audio / embed open full-size as a real tab
}

/* ---- image lightbox with zoom & pan ---- */

const zoom = { scale: 1, tx: 0, ty: 0, img: null };

function applyZoom() {
  if (!zoom.img) return;
  zoom.img.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
  els.lightboxZoomLevel.textContent = `${Math.round(zoom.scale * 100)}%`;
}

function centerImage() {
  if (!zoom.img) return;
  const stage = els.lightboxStage.getBoundingClientRect();
  zoom.scale = 1;
  zoom.tx = (stage.width - zoom.img.offsetWidth) / 2;
  zoom.ty = (stage.height - zoom.img.offsetHeight) / 2;
  applyZoom();
}

function resetZoom() {
  centerImage();
}

function setScale(next, originX, originY) {
  const stage = els.lightboxStage.getBoundingClientRect();
  const cx = (originX != null ? originX : stage.left + stage.width / 2) - stage.left;
  const cy = (originY != null ? originY : stage.top + stage.height / 2) - stage.top;
  const prev = zoom.scale;
  next = Math.min(8, Math.max(0.2, next));
  // Keep the point under the cursor stationary while zooming.
  zoom.tx = cx - (cx - zoom.tx) * (next / prev);
  zoom.ty = cy - (cy - zoom.ty) * (next / prev);
  zoom.scale = next;
  applyZoom();
}

/** @type {HTMLElement|null} */
let lbReturnFocus = null;

function openLightbox(item) {
  lbReturnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  els.lightboxStage.innerHTML = '';
  const img = document.createElement('img');
  img.src = item.url;
  img.alt = item.label || item.name || '';
  img.className = 'lightbox-img';
  img.draggable = false;
  els.lightboxStage.appendChild(img);
  zoom.img = img;
  els.lightboxCaption.textContent = item.label || item.name;
  els.lightbox.classList.remove('hidden');
  els.lightboxClose.focus(); // move focus into the modal dialog
  // Center once the image has real dimensions (lightbox must be visible first).
  if (img.complete && img.naturalWidth) centerImage();
  img.addEventListener('load', centerImage, { once: true });
}

function closeLightbox() {
  els.lightbox.classList.add('hidden');
  els.lightboxStage.innerHTML = '';
  zoom.img = null;
  if (lbReturnFocus) lbReturnFocus.focus(); // restore focus to the opener
  lbReturnFocus = null;
}

els.lightboxClose.addEventListener('click', closeLightbox);
els.lightboxZoomIn.addEventListener('click', () => setScale(zoom.scale * 1.25));
els.lightboxZoomOut.addEventListener('click', () => setScale(zoom.scale / 1.25));
els.lightboxZoomReset.addEventListener('click', resetZoom);

// Close when clicking the dimmed backdrop (but not the image or toolbar).
els.lightbox.addEventListener('click', (e) => {
  if (e.target === els.lightbox || e.target === els.lightboxStage) closeLightbox();
});

// Wheel to zoom toward the cursor.
els.lightboxStage.addEventListener(
  'wheel',
  (e) => {
    if (!zoom.img) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale(zoom.scale * factor, e.clientX, e.clientY);
  },
  { passive: false }
);

// Double-click toggles fit / 2x.
els.lightboxStage.addEventListener('dblclick', (e) => {
  if (zoom.scale > 1.01) resetZoom();
  else setScale(2, e.clientX, e.clientY);
});

// Drag to pan when zoomed in.
let panning = null;
els.lightboxStage.addEventListener('mousedown', (e) => {
  if (!zoom.img || zoom.scale <= 1) return;
  panning = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
  els.lightboxStage.classList.add('grabbing');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  zoom.tx = panning.tx + (e.clientX - panning.x);
  zoom.ty = panning.ty + (e.clientY - panning.y);
  applyZoom();
});
window.addEventListener('mouseup', () => {
  panning = null;
  els.lightboxStage.classList.remove('grabbing');
});

// Esc closes; +/- zoom; 0 resets; Tab traps focus within the modal dialog.
document.addEventListener('keydown', (e) => {
  if (els.lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === '+' || e.key === '=') setScale(zoom.scale * 1.25);
  else if (e.key === '-') setScale(zoom.scale / 1.25);
  else if (e.key === '0') resetZoom();
  else if (e.key === 'Tab') {
    const f = /** @type {NodeListOf<HTMLElement>} */ (els.lightbox.querySelectorAll('button'));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement;
    let idx = -1;
    for (let i = 0; i < f.length; i++) {
      if (f[i] === active) {
        idx = i;
        break;
      }
    }
    // Focus left the button set (e.g. blurred to the image/backdrop) — pull it back in.
    if (idx === -1) {
      (e.shiftKey ? last : first).focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    } else if (e.shiftKey && active === first) {
      last.focus();
      e.preventDefault();
    }
  }
});

async function downloadItem(item, tab) {
  const res = await window.goldfinch.downloadMedia({
    webContentsId: tab ? tab.wcId : null,
    url: item.url,
    suggestedName: item.name
  });
  if (!res || !res.ok) toast('Download failed', res && res.error ? res.error : 'Unknown error');
}

/* ------------------------------------------------------- download selected */

const bulk = {
  active: false,
  queue: [],
  inFlight: 0,
  max: 4,
  done: 0,
  ok: 0,
  fail: 0,
  total: 0,
  dir: null,
  tab: null,
  urls: new Set(),
  toastEl: null
};

// Downloadable items currently selected in the active tab.
function selectedItems() {
  const tab = activeTab();
  if (!tab) return [];
  return tab.media.filter((i) => i.type !== 'embed' && tab.selected.has(i.url));
}

function updateDownloadSelected() {
  const n = selectedItems().length;
  els.mediaDownloadSelected.disabled = n === 0;
  els.mediaDownloadSelected.textContent = n ? `Download selected (${n})` : 'Download selected';
}

async function downloadSelected() {
  if (bulk.active) {
    toast('Already downloading', `Batch in progress (${bulk.done}/${bulk.total}).`);
    return;
  }
  const tab = activeTab();
  const items = selectedItems();
  if (!items.length) return;
  if (items.length > 30 && !window.confirm(`Download ${items.length} files into a folder?`)) return;

  const dir = await window.goldfinch.chooseDownloadDir();
  if (!dir) return;

  Object.assign(bulk, {
    active: true,
    queue: items.slice(),
    inFlight: 0,
    done: 0,
    ok: 0,
    fail: 0,
    total: items.length,
    dir,
    tab,
    urls: new Set()
  });
  bulk.toastEl = persistentToast(`Downloading 0/${bulk.total}…`, dir);
  bulkPump();
}

function bulkPump() {
  while (bulk.active && bulk.inFlight < bulk.max && bulk.queue.length) {
    const item = bulk.queue.shift();
    bulk.inFlight++;
    bulk.urls.add(item.url);
    window.goldfinch
      .downloadMedia({
        webContentsId: bulk.tab && bulk.tab.wcId,
        url: item.url,
        suggestedName: item.name,
        saveDir: bulk.dir
      })
      .then((res) => {
        if (!res || !res.ok) bulkComplete(item.url, false);
      });
  }
}

// Called from the global download-done handler for any bulk URL.
function bulkComplete(url, success) {
  if (!bulk.active || !bulk.urls.has(url)) return;
  bulk.urls.delete(url);
  bulk.inFlight--;
  bulk.done++;
  success ? bulk.ok++ : bulk.fail++;
  if (bulk.toastEl) bulk.toastEl.querySelector('.toast-title').textContent = `Downloading ${bulk.done}/${bulk.total}…`;
  if (bulk.queue.length) bulkPump();
  else if (bulk.inFlight === 0) bulkFinish();
}

function bulkFinish() {
  const dir = bulk.dir;
  const el = bulk.toastEl;
  if (el) {
    el.querySelector('.toast-title').textContent = 'Download all complete';
    el.querySelector('.toast-body').textContent = `${bulk.ok} saved${bulk.fail ? `, ${bulk.fail} failed` : ''}`;
    const link = document.createElement('a');
    link.textContent = ' — Show folder';
    link.addEventListener('click', () => window.goldfinch.showItemInFolder(dir));
    el.appendChild(link);
    setTimeout(() => el.remove(), 8000);
  }
  bulk.active = false;
  bulk.toastEl = null;
}

els.mediaDownloadSelected.addEventListener('click', downloadSelected);

/* --------------------------------------------------- docked music player */

const player = { list: [], index: -1, url: null };
const pa = els.playerAudio;

function currentAudioItems() {
  const t = activeTab();
  return ((t && t.media) || []).filter((m) => m.type === 'audio');
}

// Start a track; the page's audio list becomes the playlist for prev/next.
function playAudio(item) {
  player.list = currentAudioItems();
  player.index = player.list.findIndex((m) => m.url === item.url);
  if (player.index < 0) {
    player.list = [item];
    player.index = 0;
  }
  loadCurrent();
}

function loadCurrent() {
  const item = player.list[player.index];
  if (!item) return;
  player.url = item.url;
  pa.src = item.url;
  pa.play().catch(() => {});
  els.playerTitle.textContent = item.label || item.name;
  els.player.classList.remove('hidden');
  els.playerPrev.disabled = player.index <= 0;
  els.playerNext.disabled = player.index >= player.list.length - 1;
  highlightPlaying();
}

function highlightPlaying() {
  document.querySelectorAll('.media-card').forEach((c) => {
    const card = /** @type {HTMLElement} */ (c);
    card.classList.toggle('playing', card.dataset.url === player.url);
  });
}

function togglePlay() {
  if (!pa.src) return;
  if (pa.paused) pa.play().catch(() => {});
  else pa.pause();
}
function playPrev() {
  if (player.index > 0) {
    player.index--;
    loadCurrent();
  }
}
function playNext() {
  if (player.index < player.list.length - 1) {
    player.index++;
    loadCurrent();
  }
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

els.playerPlay.addEventListener('click', togglePlay);
els.playerPrev.addEventListener('click', playPrev);
els.playerNext.addEventListener('click', playNext);
els.playerSeek.addEventListener('click', (e) => {
  const r = els.playerSeek.getBoundingClientRect();
  if (isFinite(pa.duration)) pa.currentTime = ((e.clientX - r.left) / r.width) * pa.duration;
});
pa.addEventListener('timeupdate', () => {
  const ratio = pa.duration ? pa.currentTime / pa.duration : 0;
  els.playerProgress.style.width = `${ratio * 100}%`;
  els.playerCur.textContent = fmtTime(pa.currentTime);
});
pa.addEventListener('loadedmetadata', () => {
  els.playerDur.textContent = fmtTime(pa.duration);
});
pa.addEventListener('play', () => {
  els.playerPlay.textContent = '▮▮';
});
pa.addEventListener('pause', () => {
  els.playerPlay.textContent = '▶';
});
pa.addEventListener('ended', () => {
  if (player.index < player.list.length - 1) playNext();
});

/* --------------------------------------------------------- privacy panel */

function blankPrivacy() {
  return { net: null, fp: { canvas: 0, webgl: 0, audio: 0 }, permissions: [], cookies: null };
}

function closePrivacyPanel() {
  els.privacyPanel.classList.add('collapsed');
  els.togglePrivacy.classList.remove('active');
  // Opening the media panel calls this directly, so sync aria-expanded here too
  // or the privacy toggle would keep a stale "true" after being collapsed.
  els.togglePrivacy.setAttribute('aria-expanded', 'false');
}

function togglePrivacy(force) {
  const collapsed = els.privacyPanel.classList.contains('collapsed');
  const show = force != null ? force : collapsed;
  els.privacyPanel.classList.toggle('collapsed', !show);
  els.togglePrivacy.classList.toggle('active', show);
  els.togglePrivacy.setAttribute('aria-expanded', String(show));
  if (show) {
    togglePanel(false); // close the media panel
    fetchCookies(); // cookies are fetched on demand
    renderPrivacy();
    els.privacyClose.focus(); // only move focus when actually opening
  } else if (els.privacyPanel.contains(document.activeElement)) {
    // Closing while focus is inside the (now zero-width) panel would strand it:
    // restore focus to the toggle. Guard avoids stealing focus on programmatic closes.
    // Focus-restoration guard: if the button is unpinned (hidden), .focus() is a
    // silent no-op that strands focus on <body> — fall back to the address bar.
    if (!els.togglePrivacy.classList.contains('hidden')) els.togglePrivacy.focus();
    else els.address.focus();
  }
}

els.togglePrivacy.addEventListener('click', () => { togglePrivacy(); sendActiveBounds(); });
els.togglePrivacy.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('shields', els.togglePrivacy); });

/* ------------------------------------------------------------------ devtools toggle */

// The #toggle-devtools button is a toggle reflecting the active web tab's DevTools
// open state (aria-pressed + .active styling — NOT aria-expanded; it controls no
// in-page panel). Open state's source of truth is wc.isDevToolsOpened() main-side
// (DD3); the pressed state is driven by (a) the post-toggle return of toggleDevtools,
// (b) the devtools-state-changed event, and (c) the isDevtoolsOpen reconcile on tab
// activation. Never cached.

/** @param {boolean} open */
function setDevtoolsPressed(open) {
  els.toggleDevtools.setAttribute('aria-pressed', String(open));
  els.toggleDevtools.classList.toggle('active', open);
}

els.toggleDevtools.addEventListener('click', async () => {
  const t = activeTab();
  // Inert on internal / no-wcId tabs (DD5) — never opens DevTools on goldfinch:// chrome.
  if (!t || isInternalTab(t) || t.wcId == null) return;
  const open = await window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
  setDevtoolsPressed(!!open);
});
els.toggleDevtools.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('devtools', els.toggleDevtools); });

// Live update from the Leg-1 devtools-state-changed event (catches a DevTools-window-
// initiated close). Apply only when the change targets the currently-active tab.
window.goldfinch.onDevtoolsStateChanged(({ wcId, open }) => {
  const t = activeTab();
  if (t && t.wcId === wcId) setDevtoolsPressed(!!open);
});
els.privacyClose.addEventListener('click', () => { togglePrivacy(false); sendActiveBounds(); });
// Non-modal: Escape closes the privacy panel; togglePrivacy restores focus to the toggle.
els.privacyPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePrivacy(false);
    sendActiveBounds();
  }
});
els.privacyRefresh.addEventListener('click', () => {
  fetchCookies();
  renderPrivacy();
});

window.goldfinch.onPrivacyNet((d) => {
  const tab = findTabByWcId(d.webContentsId);
  if (!tab) return;
  tab.privacy.net = d.agg;
  if (tab.id === ctx.activeTabId) renderPrivacy();
  updatePrivacyBadge();
});

window.goldfinch.onPrivacyPermission((d) => {
  const tab = findTabByWcId(d.webContentsId);
  if (!tab) return;
  const existing = tab.privacy.permissions.find((p) => p.permission === d.permission);
  if (existing) existing.granted = d.granted;
  else tab.privacy.permissions.push({ permission: d.permission, granted: d.granted });
  if (tab.id === ctx.activeTabId) renderPrivacy();
});

async function fetchCookies() {
  const tab = activeTab();
  if (!tab || tab.wcId == null) return;
  try {
    tab.privacy.cookies = await window.goldfinch.privacyCookies({ webContentsId: tab.wcId, url: tab.url });
    if (tab.id === ctx.activeTabId) renderPrivacy();
  } catch {
    /* ignore */
  }
}

async function clearCookies(scope) {
  const tab = activeTab();
  if (!tab) return;
  const res = await window.goldfinch.privacyClearCookies({ webContentsId: tab.wcId, scope, url: tab.url });
  toast('Cookies cleared', `${res.removed} cookie(s) removed`);
  fetchCookies();
}

async function clearStorage() {
  const tab = activeTab();
  if (!tab) return;
  const res = await window.goldfinch.privacyClearStorage({ url: tab.url, webContentsId: tab.wcId });
  toast(res.ok ? 'Site storage cleared' : 'Clear failed', res.ok ? res.origin : res.error || '');
}

function updatePrivacyBadge() {
  const tab = activeTab();
  const n = tab && tab.privacy.net ? tab.privacy.net.trackers.count : 0;
  // The badge count is the non-color cue (WCAG 1.4.1): the red `.alert` styling
  // is reinforced by the visible tracker count (badge + aria-label) so state isn't
  // conveyed by color alone.
  els.privacyCount.textContent = n ? String(n) : '';
  els.privacyCount.classList.toggle('hidden', !n);
  els.togglePrivacy.setAttribute('aria-label', n ? 'Shields, ' + n + ' blocked' : 'Shields');
  els.togglePrivacy.classList.toggle('alert', n > 0);
}

/* ---- Shields config (active protection toggles) ---- */

let shieldsConfig = null;
window.goldfinch.shieldsGet().then((c) => {
  shieldsConfig = c;
  renderPrivacy();
});
window.goldfinch.onShieldsChanged((c) => {
  shieldsConfig = c;
  renderPrivacy();
});

/* ---- Automation activity indicator (SC10 / DD6) ---- */

// The last activity snapshot received, cached so the jarsList() resolve can re-run
// the render with friendly jar names / jar colors once `containers` is populated
// (the snapshot can arrive first).
let lastSnap = /** @type {{ sessions?: any[] }} */ ({ sessions: [] });

// The last automation KEY state (F7, Flight 3 Leg 6 HAT — distinct from the activity
// snapshot above: this is which keys are ENABLED, not which connections are live).
// Populated from settings.getAll() (settings-get at boot, settings-changed live) —
// automationKeyHashes/automationAdminKeyHash are non-secret hash digests already
// broadcast to chrome on every settings-changed (jar-key-mint et al broadcast the
// full settings object today), so no new IPC channel is needed.
let lastKeyState = { enabledJarKeyCount: 0, adminKeyEnabled: false };

/**
 * Map a jarId to its display name via the loaded `containers`, falling back to the raw
 * jarId when the jar isn't (yet) known. jarId is operator-controlled, so the result is
 * only ever used via textContent / title — never innerHTML.
 * @param {string|null} jarId
 * @returns {string}
 */
function jarDisplayName(jarId) {
  const c = jarsClient.containers.find((x) => x.id === jarId);
  return c ? c.name : (jarId || 'jar');
}

/**
 * Derive { enabledJarKeyCount, adminKeyEnabled } from a settings.getAll() payload.
 * Defensive against a missing/malformed automationKeyHashes (never throws).
 * @param {{ automationKeyHashes?: any, automationAdminKeyHash?: any }} all
 * @returns {{ enabledJarKeyCount: number, adminKeyEnabled: boolean }}
 */
function computeAutomationKeyState(all) {
  const hashes = (all && all.automationKeyHashes && typeof all.automationKeyHashes === 'object')
    ? all.automationKeyHashes
    : {};
  return {
    enabledJarKeyCount: Object.keys(hashes).length,
    adminKeyEnabled: !!(all && all.automationAdminKeyHash),
  };
}

/**
 * Render the toolbar automation ("robot") indicator (F7, Flight 3 Leg 6 HAT —
 * operator ruling). Pulls the enabled-key state (lastKeyState) and the live-activity
 * snapshot (lastSnap) through the pure buildAutomationIndicatorModel and applies the
 * result to the DOM: hidden when no key is enabled; otherwise grayed out (idle),
 * tinted with the single active jar's color (jar), a neutral accent for
 * multiple-simultaneous-active-jars (multi), or an animated rainbow when the admin
 * key is enabled AND currently active (admin — trumps any concurrent jar activity).
 * The count badge always shows the ENABLED JAR key count (never the admin key, never
 * the live-connection count) — hidden at 0, matching the pre-F7 hidden-at-zero UX.
 */
function renderAutomationIndicator() {
  const sessions = (lastSnap && lastSnap.sessions) || [];
  const activeJarIds = sessions.filter((s) => s && s.kind === 'jar').map((s) => s.jarId);
  const adminActive = sessions.some((s) => s && s.kind === 'admin');
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: lastKeyState.enabledJarKeyCount,
    adminKeyEnabled: lastKeyState.adminKeyEnabled,
    activeJarIds,
    adminActive,
    containers: jarsClient.containers,
  });

  els.automationIndicator.classList.toggle('hidden', !model.visible);
  els.automationIndicator.classList.remove('automation-idle', 'automation-jar', 'automation-multi', 'automation-admin');

  if (!model.visible) {
    els.automationIndicatorBadge.textContent = '';
    els.automationIndicatorBadge.classList.add('hidden');
    els.automationIndicator.style.color = '';
    els.automationIndicator.title = '';
    els.automationIndicator.setAttribute('aria-label', 'Automation sessions');
    return;
  }

  els.automationIndicator.classList.add('automation-' + model.mode);
  // Defense in depth (F7 spec): re-validate before ever writing to an inline style,
  // even though buildAutomationIndicatorModel already gated `color` on isSafeColor.
  els.automationIndicator.style.color = (model.mode === 'jar' && model.color && isSafeColor(model.color))
    ? model.color
    : '';

  if (model.count > 0) {
    els.automationIndicatorBadge.textContent = String(model.count);
    els.automationIndicatorBadge.classList.remove('hidden');
  } else {
    els.automationIndicatorBadge.textContent = '';
    els.automationIndicatorBadge.classList.add('hidden');
  }

  const jarWord = model.count === 1 ? 'jar' : 'jars';
  const enabledPart = model.count > 0 ? model.count + ' ' + jarWord + ' automation-enabled' : 'automation enabled';
  const connectedNames = sessions.map((s) => (s.kind === 'admin' ? 'admin' : jarDisplayName(s.jarId)));
  // "connected" names the live transport(s) (DD6 wording — never "authorized");
  // "enabled" (above) names the persisted key state — kept as two distinct concepts.
  const label = enabledPart + (connectedNames.length ? ' — connected: ' + connectedNames.join(', ') : '');
  els.automationIndicator.title = label;
  els.automationIndicator.setAttribute('aria-label', label);
}

/**
 * Update the cached activity snapshot (live connections) and re-render.
 * @param {{ sessions?: any[] }} snap
 */
function updateAutomationIndicator(snap) {
  lastSnap = snap || { sessions: [] };
  renderAutomationIndicator();
}

/**
 * Update the cached automation KEY state (enabled jar-key count / admin-key
 * enabled) from a settings.getAll()-shaped payload and re-render.
 * @param {{ automationKeyHashes?: any, automationAdminKeyHash?: any }} all
 */
function updateAutomationKeyState(all) {
  lastKeyState = computeAutomationKeyState(all);
  renderAutomationIndicator();
}

// Initial snapshot (catches sessions attached before the chrome loaded) + live updates.
window.goldfinch.automationGetActivity().then(updateAutomationIndicator).catch(() => {});
window.goldfinch.onAutomationActivity(updateAutomationIndicator);
// Initial key state — settingsGet() with no key returns the full settings object
// (settings-get: (_e, key) => key ? settings.get(key) : settings.getAll()).
window.goldfinch.settingsGet().then(updateAutomationKeyState).catch(() => {});

/**
 * Show or hide the Media/Shields toolbar icons per the current pin state.
 * Unpinned → button hidden (`.hidden`); keyboard shortcuts remain active.
 * NOTE: the automation indicator is deliberately NOT touched here — it self-manages
 * its `.hidden` state from the enabled-key count (F7, Flight 3 Leg 6 HAT — was the
 * live session count pre-F7, SC10/DD6), and is not pinnable.
 * @param {{ media: boolean, shields: boolean, devtools: boolean }} pins
 */
function applyToolbarPins(pins) {
  els.toggleMedia.classList.toggle('hidden', !pins.media);
  els.togglePrivacy.classList.toggle('hidden', !pins.shields);
  // DD5: pin-state-driven only — never coupled to the active tab type. The button
  // stays visible on internal tabs (its click no-ops via the isInternalTab guard).
  els.toggleDevtools.classList.toggle('hidden', !pins.devtools);
}

window.goldfinch.settingsGet('toolbarPins').then(applyToolbarPins).catch(() => {});

window.goldfinch.onSettingsChanged((all) => {
  if (all && all.homePage !== undefined) homePageCache = all.homePage || HOMEPAGE;
  if (all && all.toolbarPins) applyToolbarPins(all.toolbarPins);
  // F7 (Flight 3, Leg 6 HAT): settings-changed always carries the FULL settings
  // object (settings.getAll()), so automationKeyHashes/automationAdminKeyHash are
  // always present here — re-derive the enabled-key state on every broadcast
  // (mint/revoke/admin-mint/admin-revoke all fire this channel).
  if (all) updateAutomationKeyState(all);
});

/* ------------------------------------------------------------------ page zoom */

// The address-bar zoom label is QUERY-DRIVEN, not cache-driven (DD1 stale-cache fix).
// Chromium's per-origin host-zoom map re-zooms ALL same-origin tabs in a jar when ANY
// one is zoomed, but only the active tab gets a zoom-changed broadcast — so a cached
// factor map went stale for non-active same-origin tabs (their label stuck at the last
// value they happened to be told about). Instead, refreshZoomControl() asks main for
// the tab's LIVE engine zoom (`window.goldfinch.getZoom`) on every event that can change
// the displayed value (tab activation, load completion, zoom change). No cache to go
// stale. onZoomChanged compares wcIds directly to decide "is this the active tab".

// Timer that clears the post-change "peek" reveal of the zoom control. Cleared and
// restarted on each zoom change so back-to-back changes keep the control visible.
/** @type {ReturnType<typeof setTimeout>|null} */
let zoomPeekTimer = null;
const ZOOM_PEEK_MS = 1500;

/**
 * Sync the in-address-bar zoom control to a tab: hide it entirely on internal tabs,
 * else QUERY the tab's live engine zoom factor and render it as a percentage (always —
 * even at 100%). The query is authoritative (the cache is retired) so a non-active
 * same-origin tab that was implicitly re-zoomed shows the correct shared %.
 * Race guard: the active tab is captured before the await and the result is dropped if
 * the user switched tabs while the query was in flight (an async result for a
 * since-switched tab must not overwrite the now-active tab's label).
 * Visibility/fade is CSS-driven (hover / focus-within / .zoom-control--peek); this
 * only sets the percentage text and the internal-tab hidden state.
 * @param {Tab|null} tab
 */
async function refreshZoomControl(tab) {
  if (!tab || isInternalTab(tab) || tab.wcId == null) {
    els.zoomControl.classList.add('hidden');
    return;
  }
  els.zoomControl.classList.remove('hidden');
  const queriedId = tab.id;
  const factor = await window.goldfinch.getZoom({ webContentsId: tab.wcId });
  // Drop the result if the active tab changed while the query was in flight.
  if (queriedId !== ctx.activeTabId) return;
  const pct = Math.round((factor ?? 1.0) * 100) + '%';
  els.zoomPercent.textContent = pct;
  els.zoomPercent.setAttribute('aria-label', `Current zoom ${pct}`);
}

window.goldfinch.onZoomChanged(({ wcId }) => {
  const t = activeTab();
  // Compare wcIds directly — the value is queried live, the broadcast is only the
  // "something changed, re-query" signal for the active tab.
  if (t && t.wcId === wcId) {
    refreshZoomControl(t);
    // Briefly reveal the control after a change, then fade out. Hover/focus-within
    // CSS rules still win while the peek is active, so the control stays put if the
    // pointer is over the bar or a button holds focus.
    els.zoomControl.classList.add('zoom-control--peek');
    if (zoomPeekTimer) clearTimeout(zoomPeekTimer);
    zoomPeekTimer = setTimeout(() => {
      els.zoomControl.classList.remove('zoom-control--peek');
      zoomPeekTimer = null;
    }, ZOOM_PEEK_MS);
  }
});

// −/+/reset reuse the leg-1 zoom-apply IPC. Native button activation synthesizes a
// click on Enter/Space, so these are keyboard-operable without a separate keydown
// handler. All guarded by an active, non-internal tab with a live wcId.
/** @param {'in'|'out'|'reset'} action */
function applyTabZoom(action) {
  const t = activeTab();
  if (!t || isInternalTab(t) || t.wcId == null) return;
  window.goldfinch.zoomApply({ webContentsId: t.wcId, action });
}
els.zoomOut.addEventListener('click', () => applyTabZoom('out'));
els.zoomIn.addEventListener('click', () => applyTabZoom('in'));
els.zoomReset.addEventListener('click', () => applyTabZoom('reset'));

/* ----------------------------------------------------------- find in page → overlay (SC4 / M05 F7) */
// The find UI is a main-owned chrome-class WebContentsView (find-overlay.html) floating
// over the full-bounds guest — NOT chrome DOM. openFind() drives it via findOverlayOpen;
// typing/stepping/Esc/✕ live in the overlay page; per-tab findText/findOpen sync back
// via the onFindOverlayText/onFindOverlayClosed subscriptions (see the onTab* block).

/**
 * Open the overlay find bar for the given tab (or the current active tab if omitted).
 * Guards: no find on internal tabs, none when the lightbox is open. Main shows,
 * positions, seeds, and focuses the overlay (DD6) — the guest keeps full bounds (DD8).
 * @param {Tab|null} [tab]
 */
function openFind(tab) {
  const t = tab || activeTab();
  if (!t || isInternalTab(t) || t.wcId == null) return;
  // Don't fight the lightbox (DD2 / AC6).
  if (!els.lightbox.classList.contains('hidden')) return;
  t.findOpen = true;
  window.goldfinch.findOverlayOpen({ wcId: t.wcId, findText: t.findText || '' });
}

// Main-side Ctrl+F capture → open find (page-focused path, DD2).
window.goldfinch.onOpenFind(() => openFind());

// Main-side Ctrl+J capture → open downloads (page-focused path, DD2). No active-internal
// guard here: this only fires when a web page had focus, so the active tab is web by construction.
window.goldfinch.onOpenDownloads(() => openDownloads());

function currentSite() {
  const tab = activeTab();
  if (tab && tab.privacy.net && tab.privacy.net.firstParty) return tab.privacy.net.firstParty;
  try {
    const h = new URL(tab.url).hostname.split('.');
    return h.length <= 2 ? h.join('.') : h.slice(-2).join('.');
  } catch {
    return '';
  }
}

async function setShield(key, value) {
  shieldsConfig = await window.goldfinch.shieldsSet({ [key]: value });
  renderPrivacy();
}

async function toggleSitePause() {
  const site = currentSite();
  if (!site) return;
  const paused = shieldsConfig && shieldsConfig.pausedSites.includes(site);
  shieldsConfig = await window.goldfinch.shieldsPause({ site, paused: !paused });
  renderPrivacy();
}

const SHIELD_ROWS = [
  ['block', 'Block trackers'],
  ['strip', 'Strip tracking params'],
  ['isolate', 'Isolate 3rd-party cookies'],
  ['farble', 'Farble fingerprint']
];

function pShields() {
  const s = document.createElement('div');
  s.className = 'privacy-section shields';
  const cfg = shieldsConfig || {};
  const site = currentSite();
  const paused = cfg.pausedSites && cfg.pausedSites.includes(site);

  const head = document.createElement('div');
  head.className = 'shields-head';
  head.innerHTML = '<div class="ps-title">Shields</div>';
  head.appendChild(toggle(!!cfg.enabled, (v) => setShield('enabled', v), 'Shields'));
  s.appendChild(head);

  const net = (activeTab() && activeTab().privacy.net) || {};
  // Counts are distinct DOMAINS so they line up with the lists below
  // (block -> Trackers "N blocked", isolate/strip -> distinct domains affected).
  const EFFECT = {
    block: [(net.trackers && net.trackers.blocked) || 0, 'blocked'],
    strip: [net.stripped, 'cleaned'],
    isolate: [net.cookiesBlocked, 'isolated']
  };

  const dim = !cfg.enabled || paused;
  for (const [key, label] of SHIELD_ROWS) {
    const row = document.createElement('div');
    row.className = 'shield-row' + (dim ? ' dim' : '');
    const lbl = document.createElement('span');
    lbl.className = 'shield-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);
    const eff = EFFECT[key];
    if (cfg[key] && !dim && eff && eff[0]) {
      const c = document.createElement('span');
      c.className = 'shield-count';
      c.textContent = `${eff[0]} ${eff[1]}`;
      row.appendChild(c);
    }
    row.appendChild(toggle(!!cfg[key], (v) => setShield(key, v), label));
    s.appendChild(row);
  }

  if (site) {
    const pauseRow = document.createElement('div');
    pauseRow.className = 'shield-row pause';
    pauseRow.innerHTML = `<span>${paused ? 'Shields paused on' : 'Active on'} ${escapeHtml(site)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'text-btn small';
    btn.textContent = paused ? 'Resume here' : 'Pause on this site';
    btn.addEventListener('click', toggleSitePause);
    pauseRow.appendChild(btn);
    s.appendChild(pauseRow);
  }

  // Network shields only affect NEW requests, so changes show after a reload.
  const foot = document.createElement('div');
  foot.className = 'shield-foot';
  const reload = document.createElement('button');
  reload.className = 'text-btn small';
  reload.textContent = 'Reload to apply';
  reload.addEventListener('click', () => {
    const t = activeTab();
    if (!t) return;
    // Internal tabs are excluded by disabled button state; only web tabs reach here.
    if (isWebTab(t) && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
  });
  foot.appendChild(reload);
  s.appendChild(foot);

  return s;
}

function toggle(on, onChange, label) {
  const t = document.createElement('button');
  t.className = 'switch' + (on ? ' on' : '');
  t.setAttribute('role', 'switch');
  t.setAttribute('aria-checked', String(on));
  if (label) t.setAttribute('aria-label', label);
  t.addEventListener('click', () => onChange(!on));
  return t;
}

function pJar() {
  const tab = activeTab();
  const c = tab && tab.container;
  const s = document.createElement('div');
  s.className = 'privacy-section';
  // Every tab now always carries a real container (createTab always resolves one),
  // so the no-tab/no-container branch is defensive-only — never fabricate a jar,
  // just render a neutral placeholder. pJar()'s only call site appends its return
  // value directly, so this must always return an HTMLElement.
  if (!c) {
    s.innerHTML = `<div class="ps-title">Jar</div><div class="ps-main">—</div>`;
    return s;
  }
  s.innerHTML =
    `<div class="ps-title">Jar</div>` +
    `<div class="ps-main"><span class="cm-dot" style="background:${c.color}"></span> ${escapeHtml(c.name)}${c.burner ? ' · burner (evaporates on close)' : ''}</div>`;
  const row = document.createElement('div');
  row.className = 'privacy-buttons';
  const btn = document.createElement('button');
  btn.className = 'text-btn small';
  btn.textContent = 'New identity';
  btn.title = 'Wipe this jar (cookies + storage) and reroll the fingerprint';
  // Tab-scoped disable: the privacy panel can stay open across a switch to an
  // internal goldfinch:// tab — never offer a wipe of the privileged partition.
  // (Main's identity-new handler also refuses __goldfinchInternal as defense-in-depth.)
  btn.disabled = isInternalTab(tab);
  btn.addEventListener('click', newIdentity);
  row.appendChild(btn);
  s.appendChild(row);
  return s;
}

async function newIdentity() {
  const tab = activeTab();
  // Belt-and-suspenders with pJar()'s disabled state + main's internal-session guard.
  if (!tab || isInternalTab(tab)) return;
  const res = await window.goldfinch.identityNew({ partition: tab.container.partition });
  if (res && res.ok) {
    toast('New identity', 'Jar wiped + fingerprint rerolled');
    if (isWebTab(tab) && tab.wcId != null) window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'reload', args: [] });
  } else {
    toast('New identity failed', (res && res.error) || '');
  }
}

function renderPrivacy() {
  updatePrivacyBadge();
  if (els.privacyPanel.classList.contains('collapsed')) return;
  const tab = activeTab();
  const p = tab ? tab.privacy : null;
  const net = p && p.net;
  const body = els.privacyBody;
  body.innerHTML = '';

  // Shields controls
  body.appendChild(pShields());

  // Jar / identity
  body.appendChild(pJar());

  // Connection
  const internal = !!(tab && isInternalPageUrl(tab.url || ''));
  const secure = internal || (tab && /^https:/i.test(tab.url || ''));
  body.appendChild(
    pSection(
      'Connection',
      secure ? 'ok' : 'bad',
      internal ? 'Secure — Goldfinch page' : secure ? 'Secure — HTTPS' : 'Not secure — HTTP',
      net && net.mixedContent ? `${net.mixedContent} insecure (mixed-content) request(s)` : ''
    )
  );

  // Trackers — blocked vs allowed
  const trk = net ? net.trackers : { ads: [], analytics: [], social: [], other: [], count: 0, blocked: 0, allowed: 0 };
  const tLabel = trk.count ? `${trk.blocked} blocked · ${trk.allowed} allowed` : 'no trackers detected';
  const tSec = pBigStat('Trackers', trk.count, tLabel);
  for (const cat of ['ads', 'analytics', 'social', 'other']) {
    if (trk[cat] && trk[cat].length) tSec.appendChild(pGroupStatus(cat, trk[cat]));
  }
  body.appendChild(tSec);

  // Third-party domains
  const tpCount = net ? net.thirdPartyCount : 0;
  const tpSec = pBigStat('Third-party domains', tpCount, 'distinct domains contacted');
  if (net && net.thirdPartyList.length)
    tpSec.appendChild(pList(net.thirdPartyList.map((x) => `${x.domain} (${x.count})`)));
  body.appendChild(tpSec);

  // Cookies + storage
  const ck = p && p.cookies;
  const cSec = pSection('Cookies', '', ck ? `${ck.first} first-party · ${ck.third} third-party` : 'Loading…', '');
  const cBtns = document.createElement('div');
  cBtns.className = 'privacy-buttons';
  cBtns.appendChild(pButton('Clear third-party', () => clearCookies('third')));
  cBtns.appendChild(pButton('Clear all cookies', () => clearCookies('all')));
  cBtns.appendChild(pButton('Clear site storage', clearStorage));
  cSec.appendChild(cBtns);
  if (ck && ck.list.length)
    cSec.appendChild(pList(ck.list.slice(0, 50).map((c) => `[${c.third ? '3rd' : '1st'}] ${c.name} — ${c.domain}`)));
  body.appendChild(cSec);

  // Fingerprinting
  const fp = p ? p.fp : { canvas: 0, webgl: 0, audio: 0 };
  const fpTotal = fp.canvas + fp.webgl + fp.audio;
  const fpSec = pBigStat('Fingerprinting', fpTotal, fpTotal ? 'fingerprinting API calls' : 'none detected');
  if (fpTotal) {
    fpSec.appendChild(
      pList(
        [
          fp.canvas ? `Canvas reads: ${fp.canvas}` : null,
          fp.webgl ? `WebGL GPU probe: ${fp.webgl}` : null,
          fp.audio ? `AudioContext: ${fp.audio}` : null
        ].filter(Boolean)
      )
    );
  }
  body.appendChild(fpSec);

  // Permissions
  const perms = p ? p.permissions : [];
  const permSec = pSection('Permissions', '', perms.length ? `${perms.length} requested` : 'none requested', '');
  if (perms.length)
    permSec.appendChild(pList(perms.map((x) => `${x.granted ? 'granted' : 'denied'} — ${x.permission}`)));
  body.appendChild(permSec);
}

function pSection(title, tone, main, sub) {
  const s = document.createElement('div');
  s.className = 'privacy-section';
  s.innerHTML =
    `<div class="ps-title">${escapeHtml(title)}</div>` +
    `<div class="ps-main ${tone || ''}">${escapeHtml(main)}</div>` +
    (sub ? `<div class="ps-sub warn">${escapeHtml(sub)}</div>` : '');
  return s;
}
function pBigStat(title, num, label) {
  const s = document.createElement('div');
  s.className = 'privacy-section';
  s.innerHTML =
    `<div class="ps-title">${escapeHtml(title)}</div>` +
    `<div class="ps-big ${num ? 'hot' : ''}">${num}</div><div class="ps-sub">${escapeHtml(label)}</div>`;
  return s;
}
// Tracker list with a blocked/allowed status tag per domain.
function pGroupStatus(cat, entries) {
  const d = document.createElement('div');
  d.className = 'ps-group';
  d.innerHTML = `<div class="ps-cat">${escapeHtml(cat)} (${entries.length})</div>`;
  const list = document.createElement('div');
  list.className = 'ps-list';
  list.tabIndex = 0;   // scrollable region must be keyboard-focusable so it can be arrow-scrolled (a11y)
  for (const e of entries) {
    const item = document.createElement('div');
    item.className = 'ps-item status';
    item.innerHTML =
      `<span class="tag ${e.blocked ? 'blk' : 'allow'}">${e.blocked ? 'blocked' : 'allowed'}</span>` +
      `<span class="dom${e.blocked ? ' struck' : ''}">${escapeHtml(e.domain)}</span>`;
    list.appendChild(item);
  }
  d.appendChild(list);
  return d;
}
function pList(items) {
  const l = document.createElement('div');
  l.className = 'ps-list';
  l.tabIndex = 0;   // scrollable region must be keyboard-focusable so it can be arrow-scrolled (a11y)
  l.innerHTML = items.map((i) => `<div class="ps-item">${escapeHtml(i)}</div>`).join('');
  return l;
}
function pButton(label, fn) {
  const b = document.createElement('button');
  b.className = 'text-btn small';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

/* ------------------------------------------------------------------- toasts */

const toastEls = new Map(); // url -> element

function toast(title, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div>${escapeHtml(body || '')}</div>`;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), 5000);
  return el;
}

// A toast that stays until explicitly finished (used for batch downloads).
function persistentToast(title, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-body">${escapeHtml(body || '')}</div>`;
  els.toasts.appendChild(el);
  return el;
}

window.goldfinch.onDownloadProgress((d) => {
  if (bulk.active && bulk.urls.has(d.url)) return; // batch shows one aggregate toast
  let el = toastEls.get(d.url);
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-title">Downloading</div><div class="dl-name"></div><div class="bar"><span></span></div>`;
    els.toasts.appendChild(el);
    toastEls.set(d.url, el);
  }
  el.querySelector('.dl-name').textContent = d.filename;
  el.querySelector('.toast-title').textContent = d.paused ? 'Paused' : 'Downloading';
  const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
  el.querySelector('.bar > span').style.width = `${pct}%`;
});

window.goldfinch.onDownloadDone((d) => {
  if (bulk.active && bulk.urls.has(d.url)) {
    bulkComplete(d.url, d.state === 'completed');
    return;
  }
  const el = toastEls.get(d.url);
  toastEls.delete(d.url);
  if (el) el.remove();
  if (d.state === 'completed') {
    const t = toast('Downloaded', d.filename);
    const link = document.createElement('a');
    link.textContent = ' — Show in folder';
    link.addEventListener('click', () => window.goldfinch.showItemInFolder(d.savePath));
    t.appendChild(link);
  } else {
    toast('Download ' + d.state, d.filename);
  }
});

// DD7 (M06 F3 Leg 4): payload is `{ url, openerPartition }` — resolve the
// opener's jar via inheritContainerFromPartition and consume it through the
// SAME createTab(url, container) path context-menu opens use (fresh burner for
// a burner opener; default routing for internal/unknown/missing partitions).
window.goldfinch.onOpenTab(({ url, openerPartition }) => {
  createTab(url, jarsClient.inheritContainerFromPartition(openerPartition));
});

/* --------------------------------------------------------------- shortcuts */

/**
 * The IMPURE chrome-shortcut dispatch, extracted from the global keydown handler
 * (M05 F8 Leg 2 / DD13 — refactor, not duplicate): the SAME switch bodies now
 * serve the keydown handler below AND the sheet-forwarded `chrome-shortcut-action`
 * channel (accelerators pressed while a sheet menu holds keyboard focus).
 *
 * Returns whether the action was HANDLED — the keydown handler calls
 * preventDefault only on `true`, preserving the original conditional-
 * preventDefault semantics exactly: the internal-tab / null-wcId guarded branches
 * (devtools/zoom/find) returned WITHOUT preventDefault on a guard hit → false
 * here; reload and downloads preventDefault-ed BEFORE their tab guards → always
 * true here; the rest always preventDefault-ed → always true.
 *
 * @param {string} action  a keydownToAction / sheet-accelerator chrome-class action
 * @returns {boolean} whether the action was handled (caller preventDefaults on true)
 */
function dispatchChromeAction(action) {
  switch (action) {
    // DevTools (F12 and Ctrl+Shift+I) — chrome-focused fallback (the page-focused case is
    // captured main-side in before-input-event). No-op on internal tabs / a tab with no live wcId.
    case 'devtools': {
      const t = activeTab();
      if (!t || isInternalTab(t) || t.wcId == null) return false;
      window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
      return true;
    }
    // Page-zoom fallback (DD6): route the active web tab's wcId to main.
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset': {
      const t = activeTab();
      if (!t || isInternalTab(t) || t.wcId == null) return false;
      const zoom = (action === 'zoom-out') ? 'out' : (action === 'zoom-reset') ? 'reset' : 'in';
      window.goldfinch.zoomApply({ webContentsId: t.wcId, action: zoom });
      return true;
    }
    // Chrome-focused Ctrl+F fallback (DD2 / AC2): no bar on internal tabs.
    case 'find': {
      const t = activeTab();
      if (!t || isInternalTab(t) || t.wcId == null) return false;
      openFind(t);
      return true;
    }
    case 'new-tab':
      createTab();
      return true;
    case 'close-tab':
      if (ctx.activeTabId) closeTab(ctx.activeTabId);
      return true;
    // New Window (M09 F6 Leg 4, DD5): Ctrl/Cmd+N through the one-classifier
    // path — the same body the kebab item runs. Main creates the window; the
    // new chrome document boots its home tab normally (window-boot-config).
    case 'new-window':
      window.goldfinch.windowCreate();
      return true;
    // reopen-closed-tab (M09 F4 Leg 2, DD2 step 3) — retires the Ctrl+Shift+T
    // reservation. Renderer-orchestrated two-invoke chain (design-review
    // correction: main never constructs a view itself): tabReopen() pops the
    // stack main-side; an empty stack resolves `null` and this is a SILENT
    // no-op (always returns true / swallows the key regardless, matching the
    // synchronous no-op precedent set by the 'downloads' case below). The
    // container resolves EXACTLY like a popup's does (inheritFromPartition's
    // existing fallback chain), so a jarFallback entry (partition omitted)
    // falls through to the same default-jar/burner resolution with zero new
    // code — announced via #tab-status only in that case.
    case 'reopen-closed-tab':
      window.goldfinch.tabReopen().then((entry) => {
        if (!entry) return; // empty stack — no-op (AC)
        const container = jarsClient.inheritContainerFromPartition(entry.partition);
        createTab(entry.url, container, {
          trusted: false,
          restoreHistory: { entries: entry.navEntries, index: entry.navIndex, title: entry.title },
          insertAt: entry.stripIndex,
        });
        if (entry.jarFallback) {
          announceTabStatus('Reopened tab — its cookie jar no longer exists; reopened in the default jar');
        }
      });
      return true;
    case 'focus-address':
      els.address.focus();
      els.address.select();
      return true;
    case 'toggle-panel':
      togglePanel();
      return true;
    case 'toggle-privacy':
      togglePrivacy();
      return true;
    case 'reload': {
      // preventDefault preceded the tab guard in the original handler — handled
      // (true) even when there is no / an internal active tab.
      const t = activeTab();
      // Internal tabs: reload keyboard shortcut is a no-op (internal pages are static).
      if (t && isWebTab(t) && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
      return true;
    }
    // Downloads (Ctrl+J) — chrome-focused fallback (the page-focused case is captured main-side
    // in before-input-event → onOpenDownloads). No-op if the active tab is already internal so a
    // second internal tab isn't stacked (DD2). preventDefault preceded the guard — always true.
    case 'downloads': {
      const t = activeTab();
      if (!(t && isInternalTab(t))) openDownloads();
      return true;
    }
    // Tab-cycle / tab-jump (M09 F3 Leg 1, DD1): global chrome shortcuts, work
    // regardless of focus location (address bar, guest content, internal tab) —
    // always handled/preventDefault-ed, even for an out-of-range jump (Chrome-
    // parity: Ctrl+7 with 5 tabs swallows the key and does nothing visible).
    // Follows VISUAL (DOM) order via orderedTabIds() — the F2 order authority —
    // so jumps/cycling track a keyboard/pointer reorder. A single-tab cycle is a
    // harmless self-activate (activateTab falls out of the modulo naturally).
    case 'tab-next':
    case 'tab-prev': {
      const ids = orderedTabIds();
      const len = ids.length;
      if (!len) return true; // never-zero invariant — defensive only
      const cur = Math.max(ids.indexOf(ctx.activeTabId), 0);
      const idx = action === 'tab-next' ? (cur + 1) % len : (cur - 1 + len) % len;
      activateTab(ids[idx]);
      return true;
    }
    case 'tab-jump-1':
    case 'tab-jump-2':
    case 'tab-jump-3':
    case 'tab-jump-4':
    case 'tab-jump-5':
    case 'tab-jump-6':
    case 'tab-jump-7':
    case 'tab-jump-8':
    case 'tab-jump-last': {
      const ids = orderedTabIds();
      const len = ids.length;
      if (!len) return true; // never-zero invariant — defensive only
      const idx = action === 'tab-jump-last' ? len - 1 : Number(action.slice('tab-jump-'.length)) - 1;
      if (idx >= len) return true; // out-of-range jump: Chrome-parity no-op
      activateTab(ids[idx]);
      return true;
    }
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  // The pure decision — "given (key, mods, lightboxOpen), which action?" — lives in
  // keydownToAction (../shared/keydown-action.js, imported at the top of this
  // file, same route as isSafeTabUrl). It reproduces the live gating exactly: F12 before the
  // modifier gate, mod = ctrl||meta, zoom/find/F12/Ctrl+Shift+I lightbox-deferred,
  // the t/w/l/m/Shift+P/r chain not lightbox-gated, Ctrl+Shift+I vs Shift+P by key
  // letter. The IMPURE dispatch lives in dispatchChromeAction above (extracted,
  // M05 F8 Leg 2) — preventDefault fires only when it reports handled, preserving
  // the conditional-preventDefault of the guarded branches bit-for-bit.
  const action = keydownToAction({
    key: e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    lightboxOpen: !els.lightbox.classList.contains('hidden'),
    // Real e.altKey threaded through (M09 F3, i18n ruling): AltGr digits report
    // ctrl+alt on European layouts and must not be misread as a tab-jump.
    alt: e.altKey,
  });
  if (!action) return;
  if (dispatchChromeAction(action)) e.preventDefault();
});

// DD13 (M05 F8): chrome-class accelerators forwarded from the menu-overlay sheet's
// before-input-event (keyboard focus sits in the sheet while a menu is open — the
// keydown handler above never sees them). Same dispatch, no event to preventDefault
// (main already swallowed the sheet-side input).
window.goldfinch.onChromeShortcutAction(({ action }) => {
  if (typeof action === 'string') dispatchChromeAction(action);
});

/* --------------------------------------------------------- automation hook */

// Automation hook — chrome renderer ONLY (this file is the privileged app shell;
// it is never the preload for a guest webview, so web content cannot reach this).
// Thin wrappers over the existing tab ops; main drives these via executeJavaScript
// and applies the authoritative internal-session filter on its side (DD1/DD5).
//
// openTab uses a dom-ready RACE GUARD: createTab() calls activateTab()
// synchronously, and dom-ready can fire before this Promise body runs. We
// attach the listener first, then re-check tab.wcId immediately so a
// just-fired dom-ready is never missed into the timeout path.
const OPEN_TAB_TIMEOUT_MS = 5000;

// @ts-ignore — dynamic property on Window; intentional chrome-renderer-only automation hook (DD1/DD5)
window.__goldfinchAutomation = {
  listTabs() {
    return [...tabs.values()].map((t) => ({
      wcId: t.wcId,                      // null until dom-ready
      url: t.url,
      title: t.title,
      jarId: t.container ? t.container.id : null,
      active: t.id === ctx.activeTabId,
    }));
  },
  openTab(url, jarId) {
    let container = null;
    if (jarId != null) {
      container = jarsClient.containers.find((c) => c.id === jarId) || null;
      // Unknown jarId → REFUSE (DD3): do NOT silently fall back to the resolved default.
      if (!container) throw new Error('automation: unknown-jar — no container ' + jarId);
    }
    const tab = createTab(url, container);   // null container → createTab resolves the current default jar (or a fresh burner when Burner holds the flag)
    if (!tab) return null;               // URL rejected
    if (tab.wcId != null) return tab.wcId;
    // All tabs (web + internal) are WebContentsViews (Leg 3): wait for wcId to be set
    // via the tabCreate IPC promise resolving. The old trusted-webview dom-ready poll
    // branch is removed — internal tabs no longer have a <webview> element.
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (tab.wcId != null) { clearInterval(check); clearTimeout(timeout); resolve(tab.wcId); }
      }, 20);
      const timeout = setTimeout(() => { clearInterval(check); resolve(tab.wcId ?? null); }, OPEN_TAB_TIMEOUT_MS);
    });
  },
  closeTabByWcId(wcId) {
    const tab = findTabByWcId(wcId);
    if (!tab) return false;
    closeTab(tab.id);
    return true;
  },
  activateTabByWcId(wcId) {
    const tab = findTabByWcId(wcId);
    if (!tab) return false;
    activateTab(tab.id);
    return true;
  },
};

/* ------------------------------------------------------------------- helpers */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------- boot */
// ---------------------------------------------------------------------------
// Web tab event subscriptions (module-level, route by wcId to the correct tab)
// ---------------------------------------------------------------------------

window.goldfinch.onTabDidNavigate(({ wcId, url }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.url = url;
  if (tab.id === ctx.activeTabId) {
    els.address.value = tab.url;
    updateAddressChip(tab);
    updateNavButtons();
    // Close trigger: navigation of the active tab (flight DD5).
    closeSuggestions('navigation');
  }
  tab.media = [];
  tab.selected.clear();
  tab.privacy = blankPrivacy();
  if (tab.id === ctx.activeTabId) {
    renderMedia();
    renderPrivacy();
  }
  if (tab.findOpen) {
    tab.findOpen = false;
    // Stop the navigated tab's stale highlight — works for BACKGROUND tabs too, which
    // the overlay session never targeted (tabFind's one surviving renderer use).
    window.goldfinch.tabFind({ wcId, stop: true, options: 'clearSelection' });
    // Chrome-initiated close: main resolves refocusGuest:false from the SENDER — a
    // page-initiated redirect must never yank OS focus into the guest (e.g. while
    // typing in the address bar). No find-overlay-closed echo comes back (we know).
    if (tab.id === ctx.activeTabId) window.goldfinch.findOverlayClose();
  }
});

window.goldfinch.onTabDidNavigateInPage(({ wcId, url }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.url = url;
  if (tab.id === ctx.activeTabId) {
    els.address.value = tab.url;
    updateAddressChip(tab);
    updateNavButtons();
    // Close trigger: navigation (in-page variant) of the active tab (flight DD5).
    closeSuggestions('navigation');
  }
});

window.goldfinch.onTabTitle(({ wcId, title }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.title = title;
  tab.btn.querySelector('.tab-title').textContent = title || tab.url;
  tab.btn.title = title || '';
  const name = title || tab.url;
  tab.btn.setAttribute('aria-label', name);
  const close = tab.btn.querySelector('.tab-close');
  if (close) close.setAttribute('aria-label', `Close tab: ${name}`);
});

window.goldfinch.onTabFavicon(({ wcId, favicons }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  const fav = favicons && favicons[0];
  if (!fav) return;
  tab.favicon = fav;
  const img = /** @type {HTMLImageElement|null} */ (tab.btn.querySelector('.tab-fav'));
  if (img) { img.src = fav; img.classList.remove('hidden'); }
});

window.goldfinch.onTabLoading(({ wcId, loading }) => {
  const tab = findTabByWcId(wcId);
  if (!tab || tab.id !== ctx.activeTabId) return;
  if (loading) {
    els.reload.textContent = '✕';
    els.reload.setAttribute('aria-label', 'Stop');
    els.reload.title = 'Stop';
  } else {
    els.reload.textContent = '⟳';
    els.reload.setAttribute('aria-label', 'Reload');
    els.reload.title = 'Reload';
  }
});

window.goldfinch.onTabDidFinishLoad(({ wcId }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  if (tab.id === ctx.activeTabId) refreshZoomControl(tab);
});

window.goldfinch.onTabDomReady(({ wcId }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  updateNavButtons();
  if (tab.id === ctx.activeTabId) {
    refreshZoomControl(tab);
    if (!els.privacyPanel.classList.contains('collapsed')) {
      fetchCookies();
    }
  }
});

window.goldfinch.onTabMediaList(({ wcId, mediaList }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.media = mediaList || [];
  if (tab.id === ctx.activeTabId) renderMedia();
});

// Find-overlay per-tab state sync (DD9 + the two Leg-3 channels). Text arrives on
// EVERY overlay query — empty included (deletion sync: switch-back must restore a
// blank bar, not resurrected text). Closed arrives ONLY when the user closed the bar
// overlay-side (Esc/✕); implicit closes (tab switch) stay silent so findOpen survives
// and switch-back restores. Both tolerate an already-closed tab (miss → drop).
window.goldfinch.onFindOverlayText(({ wcId, text }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.findText = text;
});

window.goldfinch.onFindOverlayClosed(({ wcId }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.findOpen = false;
});

window.goldfinch.onTabPrivacyFp(({ wcId, fpCounts }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.privacy.fp = fpCounts || tab.privacy.fp;
  if (tab.id === ctx.activeTabId) renderPrivacy();
});

window.goldfinch.onTabNavState(({ wcId, canGoBack, canGoForward }) => {
  const tab = findTabByWcId(wcId);
  if (!tab || tab.id !== ctx.activeTabId) return;
  els.back.disabled = !canGoBack;
  els.forward.disabled = !canGoForward;
});

// ---------------------------------------------------------------------------
// New container creation — the submit body for the sheet dialog's channel-6
// 'create' activation (M05 F8 Leg 3; extracted from the retired chrome dialog's
// submitDialog). Trim guard kept here as defense-in-depth — the primary
// whitespace guard is PAGE-SIDE in the sheet dialog (it stays open there).
/** @param {any} rawName */
async function createContainerAndOpenTab(rawName) {
  const name = String(rawName == null ? '' : rawName).trim();
  if (!name) return;
  // Main creates the jar and returns the container object; renderer opens the tab
  // directly. Main's invoke reply broadcasts jars-changed BEFORE it resolves
  // (jar-ipc.js), so by the time this await returns, the onJarsChanged listener has
  // already replaced `containers` with an array that includes the new jar — pushing
  // `c` here would append a duplicate, differently-referenced entry. Use the
  // returned `c` only for the immediate createTab; the next broadcast/
  // refreshOpenTabJars reconciles tab.container by id (design review, cycle 1).
  const c = await window.goldfinch.newContainerCreate(name);
  if (c) {
    createTab(currentHomePage(), c);
  }
}

// Gated on the home-page setting read, the jars boot snapshot (DD3), AND the
// window-boot-config invoke (M09 F6 Leg 4, DD5/L4): a move-created window must
// NOT boot a home tab — it receives the moved tab via adopt-tab instead. The
// suppression is main's create-chain flag served through the invoke (never a
// renderer guess); bootTab defaults true, so an invoke failure boots normally.
// Issuing the invoke is ALSO the H1 readiness signal: main releases the queued
// adopt-tab/tab-nav-state pair when it serves this invoke (the registrations
// above are module-top-level, so they provably exist by then). jarsBoot already
// swallows its own failure (defaultId stays undefined → burner routing), so
// this can never be blocked by a jars IPC error.
Promise.all([
  window.goldfinch.settingsGet('homePage').catch(() => null),
  jarsClient.boot,
  window.goldfinch.windowBootConfig().catch(() => (/** @type {{ bootTab: boolean, restoreTabs?: Array<{ url: string, jarId: string, active: boolean }> }} */ ({ bootTab: true })))
]).then(([url, , bootConfig]) => {
  // Session restore (M09 F9 / DD4 / AC5): when main serves an ordered saved tab list, CREATE
  // each tab FRESH in its saved jar — never adopt (no live source view exists at cold start).
  // This is the reopen precedent MINUS restoreHistory/insertAt (address+jar only, DD5), and it
  // must NOT use inheritContainerFromPartition: that helper takes a partition and carries a
  // default-jar/fresh-burner fallback that would silently re-home a deleted jar tab (DD4).
  // resolveRestoreContainer maps the saved jarId to a live jar over the awaited `containers`
  // snapshot; a deleted jar resolves null and the entry is DROPPED (continue) — never
  // home-substituted. Loop order gives insertion-order fidelity; each createTab self-activates,
  // so the saved-active tab is re-activated last. (Comments kept OUTSIDE the branch on purpose:
  // renderer.js trips maskComments' documented regex-literal blind spot before this point, so
  // the wiring test extracts a pure-code branch body — see session-restore-wiring.test.js.)
  if (bootConfig && Array.isArray(bootConfig.restoreTabs) && bootConfig.restoreTabs.length) {
    let activeTab = null;
    for (const t of bootConfig.restoreTabs) {
      const container = resolveRestoreContainer(t.jarId, jarsClient.containers);
      if (!container) continue;
      const tab = createTab(t.url, container, { trusted: false });
      if (tab && t.active) activeTab = tab;
    }
    if (activeTab) activateTab(activeTab.id);
  } else if (!bootConfig || bootConfig.bootTab !== false) {
    createTab(url || HOMEPAGE);
  }
});

// ---------------------------------------------------------------------------
// Evaluate-reachable automation/dogfooding seam (M07 Flight 2 leg 5, FD-approved).
// This file is an ES module: its top-level functions are module-scoped, NOT
// page globals — but the evaluate-driven surfaces (chrome-tier `evaluate` in
// dogfooding/live-boot procedures, behavior-test specs under tests/behavior/,
// and scripts/a11y-audit.mjs) call these entry points by global name via
// `executeJavaScript`. This block republishes EXACTLY the FD-approved 19-entry
// set on globalThis, each tagged with its consumer class. It is NOT the
// classic-script shared-scope collision class (deliberate assignments from
// module scope, not top-level declares in a shared lexical scope). CLOSED SET:
// do not grow it without an FD ruling — an evaluate caller outside these 19 is
// a design change, not a seam addition. (M09 F5 Leg 1 FD ruling: added
// openTabContextMenuForAudit for the new sheet:tab-context a11y state — see
// the flight's Checkpoints.)
Object.assign(/** @type {any} */ (globalThis), {
  // dogfooding (flight live-boot procedures, docs/mcp-automation.md)
  openJarsPage,
  kebabActionSettings,
  openContainerOverlay, // also driven by scripts/a11y-audit.mjs (SHEET_STATES 'sheet:container')
  // behavior-spec (tests/behavior/*.md drive these by name)
  createTab, // popup-jar-inheritance, jar-data-controls
  makeBurner, // popup-jar-inheritance, jar-data-controls
  newIdentity, // farbling-correctness
  measureWebviewsSlotDIP, // panel-slide
  openFind, // tab-surface-geometry
  // a11y-audit (scripts/a11y-audit.mjs chrome state-drivers)
  navigate,
  togglePanel,
  togglePrivacy,
  openLightbox,
  closeLightbox,
  applyToolbarPins,
  openKebabOverlay,
  openSiteInfoOverlay,
  openNewContainerOverlay,
  openPageContextMenuForAudit,
  openTabContextMenuForAudit // M09 F5 Leg 1 — SHEET_STATES 'sheet:tab-context' (FD-ruled addition)
});
