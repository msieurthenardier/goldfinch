// ES module (M07 Flight 2 leg 5): shared dependencies are explicit imports.
// index.html is a file:// document, so the specifiers are disk-true relative
// paths — no serving-path mismatch, no @ts-ignore needed (unlike the two
// internal pages' flat-served imports). The evaluate-reachable seam at the
// BOTTOM of this file republishes the automation/dogfooding entry points that
// module scoping would otherwise hide.
import { BURNER } from '../shared/burner.js';
import { buildContainerModel } from '../shared/container-menu.js';
import { buildAutomationIndicatorModel } from '../shared/automation-indicator-model.js';
import { buildVaultIndicatorModel } from '../shared/vault-indicator-model.js';
import { parsePickIndex } from '../shared/vault-picker-template.js';
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
import { createChromeContext, escapeHtml } from './chrome/context.js';
import { createJarsClient } from './chrome/jars-client.js';
import { createMediaController } from './chrome/media-controller.js';
import { createNavigationController } from './chrome/navigation-controller.js';
import { createPrivacyController } from './chrome/privacy-controller.js';
import { createShortcutController } from './chrome/shortcut-controller.js';
import { createTabController } from './chrome/tab-controller.js';
import { createWindowController } from './chrome/window-controller.js';
import {
  buildKebabModel,
  chromePointToSheet as convertChromePointToSheet,
  createChromePageActions,
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
let navigationController;
let mediaController;
let privacyController;
let windowController;
let shortcutController;
let pageActions;
const jarsClient = createJarsClient({
  bridge: window.goldfinch,
  ctx,
  burner: BURNER,
  isWebTab: (tab) => tabController.isWebTab(tab),
  isInternalTab: (tab) => tabController.isInternalTab(tab),
  activateTab: (id) => tabController.activateTab(id),
  closeTab: (id) => tabController.closeTab(id),
  updateAutomationIndicator,
  getAutomationSnapshot: () => privacyController.getAutomationSnapshot(),
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
function updateAddressChip(tab) { return navigationController.updateAddressChip(tab); }
function updateNavButtons() { return navigationController.updateNavButtons(); }
function navigate(input) { return navigationController.navigate(input); }
function toUrl(input) { return navigationController.toUrl(input); }
function closeSuggestions(reason) { return navigationController.closeSuggestions(reason); }
function resetSuggestionsForActivation() { return navigationController.resetSuggestionsForActivation(); }
function refreshZoomControl(tab) { return navigationController.refreshZoomControl(tab); }
function openFind(tab) { return navigationController.openFind(tab); }
function togglePanel(force) { return mediaController.togglePanel(force); }
function renderMedia() { return mediaController.renderMedia(); }
function openLightbox(item) { return mediaController.openLightbox(item); }
function closeLightbox() { return mediaController.closeLightbox(); }
function toast(title, body) { return mediaController.toast(title, body); }
function blankPrivacy() { return privacyController.blankPrivacy(); }
function closePrivacyPanel() { return privacyController.closePrivacyPanel(); }
function togglePrivacy(force) { return privacyController.togglePrivacy(force); }
function setDevtoolsPressed(open) { return privacyController.setDevtoolsPressed(open); }
function fetchCookies() { return privacyController.fetchCookies(); }
function updateAutomationIndicator(snap) { return privacyController.updateAutomationIndicator(snap); }
function updateAutomationKeyState(all) { return privacyController.updateAutomationKeyState(all); }
function newIdentity() { return privacyController.newIdentity(); }
function renderPrivacy() { return privacyController.renderPrivacy(); }
function announceTabStatus(text) { return windowController.announceTabStatus(text); }
function applyToolbarPins(pins) { return windowController.applyToolbarPins(pins); }
function dispatchChromeAction(action) { return shortcutController.dispatchChromeAction(action); }
function openDownloads() { return pageActions.openDownloads(); }
function openJarsPage() { return pageActions.openJarsPage(); }
function openVaultPage() { return pageActions.openVaultPage(); }
function openSiteSettingsTab() { return pageActions.openSiteSettingsTab(); }
function siteInfoModel(tab) { return pageActions.siteInfoModel(tab); }
function createContainerAndOpenTab(rawName) { return pageActions.createContainerAndOpenTab(rawName); }

// Preserve the FD-approved evaluate seam's stable callable name while the
// implementation and its mutable jar state live in the extracted client.
const makeBurner = () => jarsClient.makeBurner();
/* ------------------------------------------------------- kebab (overflow) menu */
// APG menu-button: role="menu" popup with seven static role="menuitem" items
// (New window, Settings, Downloads, Cookie jars, Passwords, Print…, Exit) + roving
// tabindex + arrow-nav. Count and order track `kebabModel` below — the single source
// of truth; if you add an item there, this line is stale until you edit it too.
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
function kebabActionVault() {
  openVaultPage();
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
  vault: kebabActionVault,
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
  },
  // Human vault flow sheets (M12 F2 Leg 3 pick-and-fill, DD5/DD6). Both are raised
  // from a guest lock-icon gesture — there is no chrome trigger element, so there is
  // no aria-expanded target and no trigger refocus (the guest owns focus). The
  // chrome-unlock leg added the vault-unlock TEMPLATE + secret handler; this leg
  // wires its trigger→open here alongside the new picker.
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
  // target and no trigger refocus (the guest owns focus). handleOverlayClosed drops the
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
  }
};
const overlayMenuClient = createOverlayMenus({
  bridge: window.goldfinch,
  states: overlayMenus,
  now: () => performance.now(),
  onActivated: dispatchOverlayActivation,
  onClosed: handleOverlayClosed
});

pageActions = createChromePageActions({
  window,
  tabs,
  createTab,
  activateTab,
  activeTab,
  isInternalTab,
  isInternalPageUrl,
  deriveSiteInfo,
  currentHomePage
});

navigationController = createNavigationController({
  window,
  document,
  ctx,
  els,
  activeTab,
  isInternalTab,
  isWebTab,
  createTab,
  openDownloads,
  isInternalPageUrl,
  shouldQuery,
  buildSuggestionModel,
  moveSelection,
  acceptSuggestResponse,
  suggestionsState: () => overlayMenus.suggestions,
  closeOverlayMenu: (reason) => overlayMenuClient.close(reason),
  openOverlayMenu: (menuType, model, anchor, startIndex, opts) => overlayMenuClient.open(menuType, model, anchor, startIndex, opts),
  leftAnchorOf: (el) => leftAnchorOf(el)
});

mediaController = createMediaController({
  window,
  document,
  ctx,
  els,
  activeTab,
  isInternalTab,
  closePrivacyPanel: () => closePrivacyPanel(),
  sendActiveBounds,
  isSafePosterUrl,
  escapeHtml,
  openToolbarContextMenu: (item, anchorEl) => openToolbarContextMenu(item, anchorEl),
  createTab
});

privacyController = createPrivacyController({
  window,
  document,
  ctx,
  els,
  activeTab,
  findTabByWcId,
  isInternalTab,
  isWebTab,
  togglePanel,
  sendActiveBounds,
  openToolbarContextMenu: (item, anchorEl) => openToolbarContextMenu(item, anchorEl),
  toast,
  jarsClient,
  buildAutomationIndicatorModel,
  isSafeColor,
  escapeHtml,
  isInternalPageUrl
});

windowController = createWindowController({
  window,
  document,
  ctx,
  els,
  tabs,
  orderedTabIds,
  releaseTabWidths,
  keyboardMove,
  commitTabMove,
  activateTab,
  closeTab,
  activeTab,
  setHomePage: (value) => { homePageCache = value || HOMEPAGE; },
  updateAutomationKeyState
});

shortcutController = createShortcutController({
  window,
  document,
  ctx,
  els,
  activeTab,
  isInternalTab,
  isWebTab,
  openFind,
  createTab,
  closeTab,
  jarsClient,
  announceTabStatus,
  togglePanel,
  togglePrivacy,
  openDownloads,
  orderedTabIds,
  activateTab,
  keydownToAction
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
    case 'vault-picker': {
      // Human fill selection (M12 F2 Leg 3, DD5/DD6). The id is `pick:<i>` — an
      // INDEX into the last picker model (metadata only; NO password on this path).
      // Resolve the row, capture the flow's wcId, then dispatch the fill in MAIN
      // (vaultFillHuman resolves the credential by (vaultId, itemId) under the MRK
      // and hands it to F1's channel — the return carries no password). On a lock
      // between pick and fill (`reason:'locked'`), re-raise the unlock prompt →
      // onVaultLockState re-opens the picker (re-pick), rather than erroring.
      const idx = parsePickIndex(id);
      const item = idx != null ? lastPickerModel[idx] : null;
      const wcId = pendingVaultFlow ? pendingVaultFlow.wcId : null;
      pendingVaultFlow = null;
      if (!item || wcId == null) break;
      Promise.resolve(window.goldfinch.vaultFillHuman({ wcId, vaultId: item.vaultId, itemId: item.id }))
        .then((r) => {
          if (r && r.reason === 'locked') {
            pendingVaultFlow = { wcId, phase: 'unlocking' };
            openOverlayMenu('vault-unlock', [], null, 0);
          }
        })
        .catch(() => {});
      break;
    }
    case 'vault-recovery-show': {
      // First-run recovery-key acknowledge (M12 F3 Leg 4). The only activation is
      // id:'ack' — the deliberate "I've saved it". Main already closed the sheet and the
      // vault page already moved to unlocked off the setup lock-state broadcast, so there
      // is nothing more to do here (no secret ever reaches this dispatch — the key lived
      // only on the sheet).
      break;
    }
    case 'vault-accesskey-show': {
      // Minted access-key acknowledge (M12 F3 Leg 5). The only activation is id:'ack' — the
      // deliberate "I've saved it". Main already closed the sheet; the vault page refreshes
      // its access-key list off its own post-mint path. Nothing reaches this dispatch (the
      // minted secret lived only on the sheet — never in the page or this chrome dispatch).
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
      navigationController.dispatchSuggestion(id);
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
    navigationController.handleSuggestionsClosed(reason);
  }
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
      Promise.resolve(window.goldfinch.vaultCaptureDismiss(captureId)).catch(() => {});
    }
  }
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

/* ------------------------------------------------------------------- boot */
window.goldfinch.onOpenTab(({ url, openerPartition }) => {
  createTab(url, jarsClient.inheritContainerFromPartition(openerPartition));
});

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

/** Open the badged vault picker for a tab: read the origin-filtered, metadata-only
 * reachable items (in main) and raise the vault-picker sheet. Enriches each row with
 * a jar display-name badge (Global vs the jar's name) — the store returns vaultId only.
 * @param {number} wcId */
async function openVaultPicker(wcId) {
  let model;
  try {
    model = await window.goldfinch.vaultReachableItems(wcId);
  } catch {
    model = [];
  }
  lastPickerModel = Array.isArray(model) ? model : [];
  // Badge enrichment: map each row's source vaultId to a display label for the sheet
  // (Global for the global vault, else the jar's name). Kept off the metadata read
  // (which returns vaultId only); dispatch still reads vaultId + id from the row.
  for (const row of lastPickerModel) {
    if (row && row.vaultId && row.vaultId !== 'global') {
      const jar = jarsClient.containers.find((c) => c.id === row.vaultId);
      row.badgeLabel = jar ? jar.name : row.vaultId;
    }
  }
  openOverlayMenu('vault-picker', lastPickerModel, null, 0);
}

window.goldfinch.onVaultGesture(({ wcId }) => {
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
window.goldfinch.onVaultRequestSetup(() => {
  // Open the master-password setup sheet. On success main drives vault-recovery-show and
  // fires the lock-state broadcast → the page moves to unlocked.
  openOverlayMenu('vault-set', [], null, 0);
});
window.goldfinch.onVaultRequestUnlock(() => {
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
window.goldfinch.onVaultRecoveryShow(({ recoveryKey }) => {
  openOverlayMenu('vault-recovery-show', { recoveryKey }, null, 0, { dismissible: false });
});

// Access-key mint cross-renderer triggers (M12 F3 Leg 5 access-keys, DD5). The vault page's
// Mint CTA routes page → main (internal-vault-request-mint carrying the NON-SECRET target) →
// chrome (here). Open the vault-stepup sheet scoped to that vault; on a successful step-up
// main drives vault-accesskey-show and the page refreshes its list. Mirrors onVaultRequestSetup
// (a bare trigger), extended with the target vault id.
window.goldfinch.onVaultRequestMint(({ target }) => {
  openOverlayMenu('vault-stepup', { target }, null, 0);
});
// Mint-success → open the read-only accesskey-show sheet with the minted { secret, keyId }.
// Opened DISMISS-DISABLED so a casual dismiss can't lose the unrecoverable one-time secret
// (Escape/backdrop/blur all inert; only acknowledge closes). The secret lives only
// main → chrome → sheet, never in the page.
window.goldfinch.onVaultAccessKeyShow(({ secret, keyId }) => {
  openOverlayMenu('vault-accesskey-show', { secret, keyId }, null, 0, { dismissible: false });
});

// Vault capture offer (M12 F2 Leg 4 capture-save, DD7). Main forwards { captureId,
// model } after a login-form submit in a set-up, unlocked, persistent-jar tab (model =
// origin/username/mode/defaultVaultId/choices — NEVER a password; the captured password
// lives only in the main-side held record). Stash the captureId (the dismiss-drop path
// reads it in handleOverlayClosed), enrich the SAVE choices with jar display labels
// (Global vs the jar's name), and open the chrome-owned vault-capture sheet. The Save
// invoke originates in the SHEET (window.menuOverlay.captureSave); chrome only opens it.
window.goldfinch.onVaultCaptureOffer(({ captureId, model }) => {
  pendingCaptureId = captureId;
  const choices = Array.isArray(model.choices)
    ? model.choices.map((vaultId) => {
        if (vaultId === 'global') return { vaultId, label: 'Global' };
        const jar = jarsClient.containers.find((c) => c.id === vaultId);
        return { vaultId, label: jar ? jar.name : vaultId };
      })
    : [];
  // captureId rides INSIDE the model so the sheet's Save invoke can carry it back.
  openOverlayMenu('vault-capture', { ...model, choices, captureId }, null, 0);
});

// Vault lock indicator (M12 F2 Leg 2 chrome-unlock, DD10). A PURE projection of
// the pushed `vault-lock-state` (single source of truth = vault-store MRK-present)
// — never a cache. Hidden until the manager is set up; then locked / unlocked.
// Leg 3 also STASHES the state (`lockState`) so the gesture handler can decide
// unlock-first-vs-pick, and CONTINUES a mid-unlock flow to the picker.
let vaultStatePushed = false;
/** @type {{ setUp: boolean, unlocked: boolean }} the last-known lock state (stashed). */
let lockState = { setUp: false, unlocked: false };
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
// Subscribe FIRST, then fetch the initial state — so a transition that fires
// between subscribe and fetch is not lost, and a fresher push always wins over a
// late init fetch (DD10 freshness contract).
window.goldfinch.onVaultLockState((state) => {
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
});
window.goldfinch.getVaultLockState()
  .then((state) => { lockState = state; if (!vaultStatePushed) renderVaultIndicator(state); })
  .catch(() => {});

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
// `executeJavaScript`. This block republishes EXACTLY the FD-approved 23-entry
// set on globalThis, each tagged with its consumer class. It is NOT the
// classic-script shared-scope collision class (deliberate assignments from
// module scope, not top-level declares in a shared lexical scope). CLOSED SET:
// do not grow it without an FD ruling — an evaluate caller outside these 23 is
// a design change, not a seam addition. (M09 F5 Leg 1 FD ruling: added
// openTabContextMenuForAudit for the new sheet:tab-context a11y state — see
// the flight's Checkpoints. M12 F3 Leg 4: added openVaultSetOverlayForAudit +
// openVaultRecoveryShowOverlayForAudit for the sheet:vault-set / vault-recovery-show
// a11y states per the leg's DD9 SHEET_STATES deliverable. M12 F3 Leg 5: added
// openVaultStepupOverlayForAudit + openVaultAccessKeyShowOverlayForAudit for the
// sheet:vault-stepup / vault-accesskey-show a11y states.)
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
  openTabContextMenuForAudit, // M09 F5 Leg 1 — SHEET_STATES 'sheet:tab-context' (FD-ruled addition)
  openVaultSetOverlayForAudit, // M12 F3 Leg 4 — SHEET_STATES 'sheet:vault-set' (DD9 addition)
  openVaultRecoveryShowOverlayForAudit, // M12 F3 Leg 4 — SHEET_STATES 'sheet:vault-recovery-show' (DD9 addition)
  openVaultStepupOverlayForAudit, // M12 F3 Leg 5 — SHEET_STATES 'sheet:vault-stepup' (DD9 addition)
  openVaultAccessKeyShowOverlayForAudit // M12 F3 Leg 5 — SHEET_STATES 'sheet:vault-accesskey-show' (DD9 addition)
});
