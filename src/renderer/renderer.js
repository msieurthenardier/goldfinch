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
import { toMediaProxyUrl } from '../shared/media-proxy.js';
import { keydownToAction } from '../shared/keydown-action.js';
import { deriveSiteInfo } from '../shared/site-info.js';
import { pageContextModel } from '../shared/page-context-model.js';
import { tabContextModel } from '../shared/tab-context-model.js';
import { resolveNewTabContainer } from '../shared/default-routing.js';
import { inheritContainerDecision, inheritFromPartition } from '../shared/inherit-container.js';
import {
  shouldQuery,
  buildSuggestionModel,
  mergeSuggestionSources,
  moveSelection,
  acceptSuggestResponse
} from '../shared/omnibox-suggest-model.js';
import { keyboardMove } from '../shared/tab-order.js';
import { classifyDragPoint } from '../shared/tab-drag-zone.js'; // the drag's reorder/tear-off zone decision (pure, window-local)
import { createPushCache } from '../shared/push-cache.js';
import { resolveRestoreContainer } from '../shared/restore-container.js'; // M09 F9 / DD4: saved jarId → live jar, or null (drop)
import { SEARCH_ENGINES, buildSearchUrl, capPendingQuery, normalizeHomePageInput } from '../shared/search-engines.js'; // M16 F1 Leg 2 / F2 Leg 2 / F3 Leg 2: the curated table (welcome-controller's engine block) + toUrl's engine-id → URL lookup + the pending-query cap + the shared domain-normalize rule (HAT item 5)
import { createChromeContext, escapeHtml } from './chrome/context.js';
import { createDownloadsController } from './chrome/downloads-controller.js';
import { createAuditHooks } from './chrome/audit-hooks.js';
import { createSiteSecurityController } from './chrome/site-security-controller.js';
import { createVaultController } from './chrome/vault-controller.js';
import { createAuthChallengeController } from './chrome/auth-challenge-controller.js'; // Mission 21 F3 Leg 1
import { createJarsClient } from './chrome/jars-client.js';
import { createBookmarksClient, bookmarkEntryToEditModel } from './chrome/bookmarks-client.js';
import { createBookmarksBar } from './chrome/bookmarks-bar.js';
import { createMediaController } from './chrome/media-controller.js';
import { createNavigationController } from './chrome/navigation-controller.js';
import { createPrivacyController } from './chrome/privacy-controller.js';
import { createShortcutController } from './chrome/shortcut-controller.js';
import { createTabController } from './chrome/tab-controller.js';
import { createWindowController } from './chrome/window-controller.js';
import { createWelcomeController } from './chrome/welcome-controller.js';
import { createLoadFailureController } from './chrome/load-failure-controller.js';
import { createHangNoticeController } from './chrome/hang-notice-controller.js'; // Mission 20 F3 Leg 2
import { classifyLoadFailure } from '../shared/load-failure.js'; // Mission 20 F1 Leg 2
import { createOverlayDispatch } from './chrome/overlay-dispatch.js'; // Mission 20 F3 Leg 1 (DD11)
import {
  buildKebabModel,
  chromePointToSheet as convertChromePointToSheet,
  createChromePageActions,
  createOverlayMenus,
  fixedTriggerMenu,
  leftSheetAnchor,
  rightSheetAnchor
} from './chrome/overlay-menus.js';

// homePageCache (M16 F2 Leg 1, DD4 — squawk 0005 closed): the searchEngineCache
// SHAPE below — boot-seeded, raw setter, no coalescing; null routes openNewTab
// to the welcome surface. The removed home-page constant is gone with it.
let homePageCache = null;
function currentHomePage() {
  return homePageCache;
}

// searchEngineCache (M16 F1 Leg 2, DD4; pre-seed null'd M16 F2 Leg 2, DD5 [high] — a placeholder would route a pre-seed search to an unchosen provider).
let searchEngineCache = null;
function setSearchEngine(value) {
  searchEngineCache = value;
}
function currentSearchEngine() {
  return searchEngineCache;
}

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
 *   findText?: string,
 *   welcome?: { reasons: Set<string>, pendingQuery: string | null } | null
 * }} Tab
 */
let tabController;
let navigationController;
let mediaController;
let privacyController;
let windowController;
let shortcutController;
let pageActions;
let bookmarksBarController;
let welcomeController;
let loadFailureController;
let hangNoticeController;
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
// Bookmarks cache (M15 F1 Leg 2; jar-aware M15 F2 Leg 3) — the jarsClient
// sibling: per-jar cache + boot + subscribe triad, plus the bookmark business
// logic the leg's line-budget ruling keeps out of this file (see
// bookmarks-client.js header). `isInternalTab` is injected lazily, the same
// `tabController`-not-yet-assigned closure jarsClient uses above. `jarsBoot`/
// `getDefaultJarId` (L3-DD-B) sequence the default-jar boot prefetch behind
// jarsClient's own boot. No `toast`: L3-DD-F's rejection-feedback sink was
// removed in M15 F3 Leg 2 (DD9) — the residual race is unhandled by design.
const bookmarksClient = createBookmarksClient({
  bridge: window.goldfinch,
  isInternalTab: (tab) => tabController.isInternalTab(tab),
  jarsBoot: jarsClient.boot,
  getDefaultJarId: () => jarsClient.defaultId,
  // sync path 5/5 (M15 F1 Leg 2, AC "five sync paths") — covers cross-window
  // edits: re-derive the active tab's star after the cache's own
  // bookmarks-changed (or ensureJar first-sight) refresh completes (not on
  // the raw broadcast, which would read a still-stale cache).
  // Extended inline (M15 F1 Leg 3, AC "Bar rendering" — single-subscriber
  // decision): the SAME post-refresh signal also re-renders the bar and
  // closes the overflow sheet if a change raced it open (DD9 cache
  // freshness). An independent onBookmarksChanged subscription from
  // bookmarks-bar.js is forbidden — it would fire before THIS cache refresh
  // resolves and could read stale cache state.
  // Jar-filtered (M15 F2 Leg 3, Implementation Guidance #6): re-derive star/
  // bar only when the signal's jar matches the ACTIVE tab's — a changed jar
  // the operator isn't looking at needs no repaint. A jar that got evicted
  // out from under the active tab is handled separately: jars-client closes
  // that orphan tab, and the resulting activation of a survivor already
  // re-derives via refreshBookmarksSurfaces below (Edge Case "jar deleted
  // while its tabs are open").
  onChanged: (jarId) => {
    const tab = activeTab();
    if (!tab || !tab.container || tab.container.id !== jarId) return;
    refreshStar(tab);
    bookmarksBarController.render(jarId);
    bookmarksBarController.closeOverflowIfOpen();
  }
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
  isSafeColor, // squawk 0020: jar-color innerHTML sink guard
  openTabContextMenu: (id, anchorEl) => openTabContextMenu(id, anchorEl),
  currentHomePage,
  currentSearchEngine, // M16 F2 Leg 2 (DD7): openNewTab's reasons rule needs both preferences
  isInternalPageUrl,
  isSafeTabUrl,
  resolveNewTabContainer,
  classifyDragPoint,
  announceTabStatus,
  updateNavButtons,
  refreshZoomControl,
  refreshStar,
  fetchCookies,
  closeSuggestions,
  resetSuggestionsForActivation,
  // Mission 20 F3 Leg 1 (DD11): late-bound (siteSecurityController is
  // constructed below, at renderer.js:901) — never a direct property read at
  // construction, exactly like the existing onAdvanced dep further down.
  refreshTabIndicators: (tab, opts) => siteSecurityController.refreshTabIndicators(tab, opts),
  renderMedia,
  renderPrivacy,
  setDevtoolsPressed,
  refreshBookmarksSurfaces,
  showWelcomePanel,
  hideWelcomePanel,
  showLoadFailurePanel,
  hideLoadFailurePanel,
  projectHangNotice
});

const {
  createTab,
  openWelcomeTab,
  attachView,
  openNewTab, // M16 F2 Leg 1
  welcomeReasons, // M16 F2 Leg 2 (DD7): shared by the boot path below
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
function showWelcomePanel(tab) {
  return welcomeController.show(tab);
} // M16 F2 Leg 1
function hideWelcomePanel() {
  return welcomeController.hide();
} // M16 F2 Leg 1
function showLoadFailurePanel(tab) {
  return loadFailureController.show(tab);
} // Mission 20 F1 Leg 2
function hideLoadFailurePanel() {
  return loadFailureController.hide();
} // Mission 20 F1 Leg 2
function projectHangNotice(tab) {
  return hangNoticeController.project(tab);
} // Mission 20 F3 Leg 2
function updateAddressChip(tab) {
  return navigationController.updateAddressChip(tab);
}
function updateNavButtons() {
  return navigationController.updateNavButtons();
}
function navigate(input) {
  return navigationController.navigate(input);
}
function toUrl(input) {
  return navigationController.toUrl(input);
}
function closeSuggestions(reason) {
  return navigationController.closeSuggestions(reason);
}
function resetSuggestionsForActivation() {
  return navigationController.resetSuggestionsForActivation();
}
function refreshZoomControl(tab) {
  return navigationController.refreshZoomControl(tab);
}
function refreshStar(tab) {
  return navigationController.refreshStar(tab);
}
// M15 F2 Leg 3 (L3-DD-C): the activation-class bar-suppression + bar-render
// closure — called from tab-controller.js's two activation-class sites
// (wcId arrival, activateTab body) alongside refreshStar above. Suppressed
// (burner or internal — reuses the injected isInternalTab predicate rather
// than re-deriving container.id === 'internal' inline) forwards to
// window-controller's setBarSuppressed and skips the render; visible primes
// the tab's jar (ensureJar, once per unseen jar) and renders it.
function refreshBookmarksSurfaces(tab) {
  const suppressed = !!(tab && ((tab.container && tab.container.burner) || isInternalTab(tab)));
  windowController.setBarSuppressed(suppressed);
  if (!suppressed && tab && tab.container) {
    bookmarksClient.ensureJar(tab.container.id);
    bookmarksBarController.render(tab.container.id);
  }
}
function openFind(tab) {
  return navigationController.openFind(tab);
}
function togglePanel(force) {
  return mediaController.togglePanel(force);
}
function renderMedia() {
  return mediaController.renderMedia();
}
function openLightbox(item) {
  return mediaController.openLightbox(item);
}
function closeLightbox() {
  return mediaController.closeLightbox();
}
function toast(title, body) {
  return mediaController.toast(title, body);
}
function blankPrivacy() {
  return privacyController.blankPrivacy();
}
function closePrivacyPanel() {
  return privacyController.closePrivacyPanel();
}
function togglePrivacy(force) {
  return privacyController.togglePrivacy(force);
}
function setDevtoolsPressed(open) {
  return privacyController.setDevtoolsPressed(open);
}
function fetchCookies() {
  return privacyController.fetchCookies();
}
function updateAutomationIndicator(snap) {
  return privacyController.updateAutomationIndicator(snap);
}
function updateAutomationKeyState(all) {
  return privacyController.updateAutomationKeyState(all);
}
function newIdentity() {
  return privacyController.newIdentity();
}
function renderPrivacy() {
  return privacyController.renderPrivacy();
}
function announceTabStatus(text) {
  return windowController.announceTabStatus(text);
}
function applyToolbarPins(pins) {
  return windowController.applyToolbarPins(pins);
}
function dispatchChromeAction(action) {
  return shortcutController.dispatchChromeAction(action);
}
function openDownloads() {
  return pageActions.openDownloads();
}
function openJarsPage() {
  return pageActions.openJarsPage();
}
function openVaultPage() {
  return pageActions.openVaultPage();
}
function openSiteSettingsTab() {
  return pageActions.openSiteSettingsTab();
}
function siteInfoModel(tab) {
  return pageActions.siteInfoModel(tab);
}
function createContainerAndOpenTab(rawName) {
  return pageActions.createContainerAndOpenTab(rawName);
}

// Preserve the FD-approved evaluate seam's stable callable name while the
// implementation and its mutable jar state live in the extracted client.
const makeBurner = () => jarsClient.makeBurner();
/* ------------------------------------------------------- kebab (overflow) menu */
// APG menu-button: role="menu" popup with seven role="menuitem" items — New window,
// then Settings/Downloads/Cookie jars/Passwords, then Print…/Exit — divided into three
// bands by two role="separator" rows (skipped by the roving tabindex/arrow-nav, no
// role="menuitem"). Count and order track `kebabModel` below — the single source of
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

let overlayMenuClient;
let siteSecurityController;
const downloadsController = createDownloadsController({
  els,
  goldfinch: window.goldfinch,
  openDownloadsPage: openDownloads,
  rightSheetAnchor,
  openOverlayMenu: (...args) => overlayMenuClient.open(...args),
  closeOverlayMenu: (reason) => overlayMenuClient.close(reason),
  triggerOverlayMenu: (menuType, open) => overlayMenuClient.trigger(menuType, open)
});
const { showDownloadsIndicatorForAudit, openDownloadsOverlayForAudit } = downloadsController;
// Vault flow controller (M15 F2 Leg 1 renderer-extraction): the downloads:
// construction-order precedent generalized — constructed here, ahead of the
// overlayMenus table (its overlayStates spread into it below) and ahead of
// overlayMenuClient itself, so openOverlayMenu is a late-bound closure exactly
// like downloadsController's own. openVaultPage is the module-level wrapper
// (defined above, reads `pageActions` lazily) — safe to pass now because it is
// only CALLED after pageActions is assigned, same precedent as openDownloads
// above feeding downloadsController before pageActions exists.
const vaultController = createVaultController({
  els,
  goldfinch: window.goldfinch,
  jarsClient,
  isSafeColor,
  openVaultPage,
  openToolbarContextMenu: (item, anchorEl) => openToolbarContextMenu(item, anchorEl), // squawk 0038
  openOverlayMenu: (...args) => overlayMenuClient.open(...args),
  // Late-bound like the bookmarks-client's: `toast` is a hoisted function declaration
  // here, but the wrapper keeps this construction independent of definition order.
  toast: (title, body) => toast(title, body)
});
const {
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
} = vaultController;
// HTTP basic-auth + TLS client-cert challenge controller (M14 F1 L2/L3, extracted
// M21 F3 Leg 1 "sheet-type-dispatch"): the vaultController construction-order
// precedent above — openOverlayMenu is a late-bound closure (overlayMenuClient
// does not exist yet at this point in the module, exactly the TDZ hazard
// vaultController's own construction avoids the same way).
const authChallengeController = createAuthChallengeController({
  goldfinch: window.goldfinch,
  openOverlayMenu: (...args) => overlayMenuClient.open(...args)
});

/* ---- menu-overlay sheet state (shared monotonic open-token discipline) ---- */
const overlayMenus = {
  kebab: fixedTriggerMenu(() => els.kebab),
  container: fixedTriggerMenu(() => els.newTabMenu),
  'site-info': fixedTriggerMenu(() => els.addressChip),
  'new-container': fixedTriggerMenu(() => els.newTabMenu),
  // Star/bar/overflow quick-edit popover (M15 F1 Leg 2, flight DD4). The star
  // is a real trigger button (fixedTriggerMenu — the kebab/container/site-info
  // shape), so aria-expanded + escape/activated refocus land on it for free.
  'bookmark-edit': fixedTriggerMenu(() => els.star),
  // Bookmarks-bar overflow chevron (M15 F1 Leg 3, DD9): the kebab/container
  // shape — a real trigger button, template family 'menu' (shares menuNode —
  // no NODE_OF_ENTRY addition, per the leg's audit-seam AC).
  'bookmarks-overflow': fixedTriggerMenu(() => els.bookmarksOverflow),
  'cert-override': fixedTriggerMenu(() => document.getElementById('load-failure-advanced')), // M20 F2 L3 (DD3/DD4): LAZY — the button is built after this table
  'cert-viewer': fixedTriggerMenu(() => els.addressChip), // M20 F2 L4 (DD9): from the panel, refocus lands on the chip (acceptable)
  'page-context': {
    open: false,
    token: 0,
    blurClosedAt: -Infinity,
    ariaTarget: () => null,
    refocus(reason) {
      const ret = pageCtx.returnFocus;
      pageCtx.returnFocus = null;
      if (reason !== 'escape') return;
      if (ret && ret.isConnected && ret !== document.body && typeof ret.focus === 'function') ret.focus();
      else els.address.focus();
    }
  },
  'tab-context': {
    open: false,
    token: 0,
    blurClosedAt: -Infinity,
    ariaTarget: () => null,
    refocus(reason) {
      const ret = tabCtx.returnFocus;
      tabCtx.returnFocus = null;
      if (reason !== 'escape') return;
      if (ret && ret.isConnected && ret !== document.body && typeof ret.focus === 'function') ret.focus();
      else els.address.focus();
    }
  },
  suggestions: {
    open: false,
    token: 0,
    blurClosedAt: -Infinity,
    ariaTarget: () => null, // DD11: textbox disallows aria-expanded; listbox is cross-document
    refocus() {}
  },
  // HTTP basic-auth ('auth-basic') + TLS client-cert ('cert-picker') challenge
  // prompts (M14 F1 L2/L3) — owned by auth-challenge-controller.js (extracted
  // M21 F3 Leg 1). Neither has a chrome trigger element (both raised from main's
  // pending-challenge store), so neither has an aria-expanded target or trigger
  // refocus; the close reason's DD2 lifecycle bucket (resolve vs re-present) is
  // mapped MAIN-SIDE by the store's manager close-observer.
  ...authChallengeController.overlayStates,
  // The 11 vault sheet states (vault-unlock, vault-picker, vault-capture, vault-set,
  // vault-recovery-show, vault-stepup, vault-accesskey-show, vault-import-unlock,
  // vault-change-master, vault-recover, vault-adminkey-show) — owned by
  // vault-controller.js (M15 F2 Leg 1 renderer-extraction), the `downloads:` single-
  // entry precedent generalized to a spread. None has a chrome trigger element (all
  // raised from a guest gesture or a cross-renderer vault-page request), so none has
  // an aria-expanded target or trigger refocus; per-sheet rationale lives with the
  // states in vault-controller.js.
  ...vaultController.overlayStates,
  downloads: downloadsController.overlayState
};
overlayMenuClient = createOverlayMenus({
  bridge: window.goldfinch,
  states: overlayMenus,
  now: () => performance.now(),
  measureSlot: measureWebviewsSlotDIP, // squawk 0057 — sheet placement for a viewless welcome tab (rationale in overlay-menus.js)
  onActivated: (payload) => {
    if (
      !downloadsController.handleActivation(payload) &&
      !vaultController.handleActivation(payload) &&
      !siteSecurityController.handleActivation(payload)
    )
      dispatchOverlayActivation(payload);
  },
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
  openNewTab // M16 F2 Leg 1 (DD4)
});

navigationController = createNavigationController({
  window,
  document,
  ctx,
  els,
  activeTab,
  findTabByWcId, // M17 F1 L2 (DD7): resolves tab-did-navigate's wcId for the Enter-focus-handoff one-shot
  isInternalTab,
  isWebTab,
  createTab,
  openNewTab,
  attachView, // M16 F2 Leg 1: the `+` pill (DD4) / navigate() on a welcome tab (DD2)
  openWelcomeTab,
  refreshWelcome: showWelcomePanel,
  openDownloads, // M16 F2 Leg 2 (DD3): the search handoff
  bookmarksClient,
  isInternalPageUrl,
  buildSearchUrl,
  currentSearchEngine,
  capPendingQuery,
  normalizeHomePageInput, // M16 F1 Leg 2 / F2 Leg 2 / F3 Leg 2: toUrl's engine lookup + live cache read + the pending-query cap + the shared domain-normalize rule (HAT item 5)
  shouldQuery,
  buildSuggestionModel,
  mergeSuggestionSources, // M15 F1 Leg 4, DD11 — line-budget discipline
  moveSelection,
  acceptSuggestResponse,
  suggestionsState: () => overlayMenus.suggestions,
  closeOverlayMenu: (reason) => overlayMenuClient.close(reason),
  openOverlayMenu: (menuType, model, anchor, startIndex, opts) =>
    overlayMenuClient.open(menuType, model, anchor, startIndex, opts),
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
  toMediaProxyUrl,
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
  setHomePage: (value) => {
    homePageCache = value;
  }, // M16 F2 Leg 1 (DD4): raw setter, the removed home-page constant is gone
  setSearchEngine, // M16 F1 Leg 2: boot seed + settings-changed handler both write through this
  updateAutomationKeyState,
  sendActiveBounds
});

// M16 F2 Leg 1 (DD1/DD7): the welcome panel's own controller (chrome DOM in #webviews).
welcomeController = createWelcomeController({
  document,
  els,
  attachView,
  welcomeSetPreference: window.goldfinch.welcomeSetPreference,
  onSettingsChanged: window.goldfinch.onSettingsChanged,
  SEARCH_ENGINES,
  buildSearchUrl,
  currentSearchEngine,
  currentHomePage,
  normalizeHomePageInput // M16 F2 Leg 2 (DD7) / F3 Leg 2 (HAT item 5): engine block data + attach/gating reads + the domain-normalize rule
});
loadFailureController = createLoadFailureController({
  document,
  els,
  bridge: window.goldfinch,
  findTabByWcId,
  isActiveTab: (tab) => tab.id === ctx.activeTabId,
  classifyLoadFailure, // Mission 20 F1 Leg 2 (DD1)
  refreshTabIndicators: (tab, opts) => siteSecurityController.refreshTabIndicators(tab, opts), // Mission 20 F3 Leg 1 (DD11): late-bound (constructed below)
  onAdvanced: (tab) => siteSecurityController.openCertOverrideOverlay(tab), // M20 F2 L3: late-bound (constructed below)
  onViewCertificate: (tab) => siteSecurityController.openCertificateViewer(tab) // M20 F2 L4: late-bound (constructed below)
});

// Mission 20 F3 Leg 2 (DD3): the hang bar's own controller. `refreshStrip`
// reuses load-failure-controller.js's `applyStripState` — the ONE
// `dataset.loadState` writer — rather than a second write site.
hangNoticeController = createHangNoticeController({
  els,
  isActiveTab: (tab) => tab.id === ctx.activeTabId,
  findTabByWcId,
  tabNavigate: window.goldfinch.tabNavigate,
  refreshStrip: (tab) => loadFailureController.applyStripState(tab),
  sendActiveBounds
});
window.goldfinch.onTabHung(hangNoticeController.onTabHung);

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
  openNewTab, // M16 F2 Leg 1 (DD4): Ctrl+T
  closeTab,
  jarsClient,
  announceTabStatus,
  togglePanel,
  togglePrivacy,
  openDownloads,
  orderedTabIds,
  activateTab,
  keydownToAction,
  // Ctrl+D (M15 F1 Leg 2, flight DD5): behaves exactly like a star click — the
  // one shared handler (star click / Ctrl+D / page-context "Bookmark this
  // page" all funnel through it).
  handleBookmarkStarActivate,
  focusLoadFailureHeading: loadFailureController.focusHeading // Mission 20 F1 Leg 2, DD6: F6 routing
});

// Static kebab model — labels rendered via textContent in the sheet (DD8).
// New window first (Chrome adjacency: window/tab creation ahead of app pages).
// DD2 anchor nuance: the CHROME client rect translates chrome→sheet by
// subtracting the guest-region origin (#webviews); y clamps to 0 (DD12, flush
// at the top). Generic — Leg 5 HAT fix reuses it for the far-right bookmarks-overflow chevron.
const rightAnchorOf = (el) => {
  const wv = els.webviews.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return rightSheetAnchor(wv, r);
};
const kebabAnchor = () => rightAnchorOf(els.kebab);
// Left-aligned toolbar anchors (Leg 3 — ▾ and 🔒): same chrome→sheet translation,
// LEFT edge, clamped ≥ 0; y clamps to 0 (DD12 flush-at-top, the accepted shift).
/** @param {HTMLElement} el */
const leftAnchorOf = (el) => {
  const wv = els.webviews.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return leftSheetAnchor(wv, r);
};
const containerAnchor = () => leftAnchorOf(els.newTabMenu);

// Bookmarks bar + overflow (M15 F1 Leg 3) — houses ALL bar/overflow business
// logic per the leg's line-budget FD ruling (this file gets only the
// construction below, the extended onChanged closure above, and the
// dispatchOverlayActivation/seam wiring further down). Constructed here
// (after `leftAnchorOf`'s own `const` declaration, just above) — a `const`
// arrow function, unlike the hoisted `function` declarations this file
// otherwise forward-references, is TDZ-live only after its own line runs.
bookmarksBarController = createBookmarksBar({
  document,
  ResizeObserver,
  els,
  bookmarksClient,
  navigate,
  createTab,
  openBookmarkEditOverlay,
  // M15 F2 Leg 3 DD7b: the active tab's container, for the bar's two
  // open-in-new-tab paths — a `null` container would resolve the current
  // DEFAULT jar instead of the bookmark's own.
  activeContainer: () => {
    const t = activeTab();
    return t ? t.container : null;
  },
  overlayMenuClient,
  overlayMenuState: overlayMenus['bookmarks-overflow'],
  rightAnchorOf, // Leg 5 HAT fix — right-anchor the far-right chevron (kebab idiom)
  // M15 F3 Leg 4 (drag onto page): the PER-WCID navigation form — `navigate` is
  // active-tab-only and the drop may land on a background tab's guest (AC9) —
  // plus the bare bookmark-drag bookend sends.
  tabNavigate: (payload) => window.goldfinch.tabNavigate(payload),
  bookmarkDragStarted: () => window.goldfinch.bookmarkDragStarted(),
  bookmarkDragEnded: () => window.goldfinch.bookmarkDragEnded()
});
// Main forwards a bookmark drop as `{ targetWcId }` after checking (and
// consuming) this window's drag declaration; the bar resolves the url from its
// own held session and navigates that tab.
window.goldfinch.onBookmarkDrop((d) => bookmarksBarController.handleDropSignal(d));
// M15 F3 Leg 5a: the bar → overflow half — main forwards the SHEET's drop index
// after its own sender/token/menuType gate; the bar resolves the bookmark, jar,
// and visible count from its dragstart-time hold and commits the reorder.
window.goldfinch.onBookmarkOverflowDrop((d) => bookmarksBarController.handleOverflowDrop(d));
// M15 F3 Leg 5b: the overflow → bar half — the sheet is the drag SOURCE, so the
// chrome has no dragstart/dragend for it. Main forwards the sheet's own start/end
// lifecycle signals and the bar builds its foreign-drag session from them.
window.goldfinch.onBookmarkSheetDrag((d) => bookmarksBarController.handleSheetDrag(d));
// Initial paint (M15 F2 Leg 3, L3-DD-B): the bar renders the DEFAULT jar's
// bookmarks once the cache's boot prefetch resolves — before any tab exists,
// so the common case (first tab lands in the default jar) shows correct
// content instantly. The first real activation (createTab/activateTab, both
// call refreshBookmarksSurfaces) re-renders for the actual active tab's jar
// regardless, so a session-restore into a different jar still lands right.
bookmarksClient.boot.then(() => bookmarksBarController.render(jarsClient.defaultId));

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
  openOverlayMenu(
    'container',
    buildContainerModel(jarsClient.containers, jarsClient.defaultId),
    containerAnchor(),
    startIndex
  );
// New-container dialog (AC4): the template ignores the anchor (centered via CSS)
// but the open path stays uniform (fresh token, aria on the ▾ refocus trigger).
const openNewContainerOverlay = () => openOverlayMenu('new-container', [], containerAnchor(), 0);
// Bookmark-edit popover opener (M15 F1 Leg 2, flight DD4/AC "Anchored
// positioning attempt"; anchor PARAMETERIZED leg 3 — bar/overflow right-click
// reuse this same opener anchored at their own trigger element instead of the
// star) — the toolbar-unpin idiom: measure the anchor element's own rect and
// translate chrome→sheet (chromePointToSheet, defined further down — hoisted
// function declaration; already pure + unit-tested via its underlying
// convertChromePointToSheet, overlay-menus.test.js). The FIRST-EVER anchored
// modal card (leg-2 design review): the sheet applies positionNode to the
// CARD, not the backdrop (menu-overlay.css / menu-overlay.js).
/** @param {any} bookmark store entry, translated via bookmarkEntryToEditModel (entry.title → model.name — HAT FIX, Leg 5) @param {HTMLElement} [anchorEl] defaults to the star (leg-2 call sites) @param {string|null} [jarId] M15 F2 Leg 3, L3-DD-E: the owning jar, captured HERE at open — never re-resolved at submit (the DD13 TOCTOU) */
function openBookmarkEditOverlay(bookmark, anchorEl = els.star, jarId = null) {
  bookmarksClient.captureEditJar(jarId);
  const r = anchorEl.getBoundingClientRect();
  // HAT FIX 1 (M15 F2 Leg 4 HAT fixes): the captured jarId ALSO rides the OPEN
  // OPTIONS bag (never the edit model — the model populates the sheet's visible
  // name/url inputs, so a jarId there would be dead weight or a future
  // accidental render). menu-overlay-manager.js retains it on the current-menu
  // record; register-overlay-ipc.js's submit handler reads it back to consult
  // the store BEFORE closing the sheet.
  openOverlayMenu('bookmark-edit', bookmarkEntryToEditModel(bookmark), chromePointToSheet(r.left, r.bottom), 0, {
    jarId
  });
}
// The ONE shared handler for star click / Ctrl+D / page-context "Bookmark
// this page" (AC "Star click / Ctrl+D behavior"): bookmarksClient.activateStar
// resolves the entry to edit (creating it first when unbookmarked) or null
// (inert — internal tab / burner tab / no live wcId); a non-null resolution
// opens the popover, capturing `tab`'s OWN jar (L3-DD-E) — all three entry
// points (star click, Ctrl+D, page-context) pass the tab the action is
// actually about, so this one line covers the capture for all three.
/** @param {any} tab */
function handleBookmarkStarActivate(tab) {
  bookmarksClient.activateStar(tab).then((bookmark) => {
    if (bookmark) openBookmarkEditOverlay(bookmark, els.star, tab && tab.container ? tab.container.id : null);
  });
}
// Page-context sheet opener (Leg 4). The four invocation sites (guest
// right-click subscription, chrome-focused keyboard, toolbar-unpin, audit hook)
// live further down; they capture pageCtx FIRST, then call with a POINT anchor:
// guest params.x/y ride 1:1 (DD2 payoff — sheet CSS coords ≡ guest-region DIPs,
// no els.webviews offset translation on that path); the chrome-anchored modes
// (keyboard / toolbar / audit) pass chrome→sheet-translated points. The model is
// built from the captured params by the pure shared builder; toolbar mode passes
// pageCtx.toolbarItem.
// isBookmarked (M15 F1 Leg 2): computed from THIS chrome's own bookmarks cache
// keyed on the captured tab's URL and jar — never guest-influenced `params`
// (AC). canBookmark (M15 F2 Leg 3, L3-DD-D): omits the item entirely for a
// burner/internal captured tab, rather than a present-but-inert one.
/** @param {{ x: number, y: number }} anchor */
const openPageContextOverlaySheet = (anchor) => {
  const srcTab = pageCtx.wcId != null ? findTabByWcId(pageCtx.wcId) : null;
  const isBookmarked = !!(srcTab && srcTab.container && bookmarksClient.findByUrl(srcTab.container.id, srcTab.url));
  const canBookmark = !!(srcTab && !isInternalTab(srcTab) && !(srcTab.container && srcTab.container.burner));
  openOverlayMenu(
    'page-context',
    pageContextModel(pageCtx.params, pageCtx.toolbarItem, {
      isBookmarked,
      canBookmark,
      vaultLocked: vaultController.isVaultLocked()
    }),
    anchor,
    0
  ); // squawk 0038
};

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

// Mission 20 Flight 2 Leg 1 (DD11 seed): the 🔒 site-info chip's trigger
// listeners, siteInfoAnchor, and openSiteInfoOverlay now live in
// site-security-controller.js — moved verbatim, behaviour unchanged.
// `openSiteInfoOverlay` is destructured back out for the evaluate seam tail
// (same bare-name republish-by-name discipline as audit-hooks.js above).
siteSecurityController = createSiteSecurityController({
  els,
  openOverlayMenu,
  siteInfoModel,
  activeTab,
  overlayTriggerClick,
  leftAnchorOf,
  openSiteSettingsTab,
  bridge: window.goldfinch,
  findTabByWcId,
  closeOverlayMenu: (reason) => overlayMenuClient.close(reason), // M20 F2 L3 (DD3)
  isActiveTab: (tab) => tab.id === ctx.activeTabId,
  updateAddressChip // Acceptance-run fix pass F3: refresh the chip on the tab-security push
});
const { openSiteInfoOverlay, openCertificateViewer } = siteSecurityController;

// ★ star trigger (M15 F1 Leg 2): native <button> — Enter/Space already
// synthesize click, no separate keydown handler needed.
els.star.addEventListener('click', () => handleBookmarkStarActivate(activeTab()));

// Bookmark-edit-submit forward subscriber (M15 F1 Leg 2): main validates +
// closes the sheet, then forwards here; the actual bookmarkUpdate/
// bookmarkRemove issue lives in bookmarksClient (chrome is the sole
// bookmark-mutation issuer).
window.goldfinch.onBookmarkEditSubmit((payload) => bookmarksClient.handleEditSubmit(payload));

// Mission 20 Flight 3 Leg 1 (DD11): the generic activation switch and the
// shared overlay-closed sink now live in overlay-dispatch.js (behaviour-
// preserving extraction — the F2 debrief's recommendation 2). Constructed
// here, in the switch's old textual position, so every free identifier it
// used to close over is still readable at this point in module evaluation.
// `pageCtx`/`tabCtx` are threaded as getters (both are `const`s declared
// further down — a direct property here would be a TDZ ReferenceError at
// load); `refreshTabIndicators`/other late-constructed-controller reads use
// the same late-bound-closure discipline elsewhere in this file.
const overlayDispatch = createOverlayDispatch({
  KEBAB_ACTIONS,
  openNewContainerOverlay,
  openNewTab,
  jarsClient,
  openJarsPage,
  createContainerAndOpenTab,
  bookmarksBarController,
  findTabByWcId,
  createTab,
  basenameFromUrl,
  toast,
  capPendingQuery,
  toUrl,
  openWelcomeTab,
  orderedTabIds,
  ctx,
  activateTab,
  closeTab,
  tabs,
  announceTabStatus,
  moveOutcomeMessage,
  dispatchChromeAction,
  handleBookmarkStarActivate,
  dispatchSuggestion: (id) => navigationController.dispatchSuggestion(id),
  handleSuggestionsClosed: (reason) => navigationController.handleSuggestionsClosed(reason),
  lockVaultNow: () => vaultController.lockNow(),
  vaultHandleClosed: (payload) => vaultController.handleClosed(payload),
  siteSecurityHandleClosed: (payload) => siteSecurityController.handleClosed(payload),
  bridge: window.goldfinch,
  els,
  pageCtx: () => pageCtx,
  tabCtx: () => tabCtx
});
// Function DECLARATIONS (hoisted), not `const` thunks: `overlayMenuClient`'s
// construction (well above this point) already references these two names by
// value in its onActivated/onClosed wiring — a `const` here would be a TDZ
// ReferenceError at that earlier line. The body reads `overlayDispatch` at
// CALL time, by which point module evaluation has completed and it is
// assigned — the same late-bound discipline the rest of this file uses.
function dispatchOverlayActivation(payload) {
  return overlayDispatch.dispatchActivation(payload);
}
function handleOverlayClosed(payload) {
  return overlayDispatch.handleClosed(payload);
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
/** @type {{ wcId: number|null, params: any, returnFocus: HTMLElement|null, toolbarItem: ('media'|'shields'|'devtools'|'vault'|null) }} */
const pageCtx = { wcId: null, params: null, returnFocus: null, toolbarItem: null }; // 'media' | 'shields' | 'devtools' | 'vault' | null  (null = page-content mode)

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
    x: params && typeof params.x === 'number' ? params.x : 0,
    y: params && typeof params.y === 'number' ? params.y : 0
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
  // Gate: toolbar pin buttons + the vault indicator (squawk 0038, same shape) fire both
  // contextmenu AND this keydown — their own contextmenu listeners already open the sheet.
  if (
    target === els.toggleMedia ||
    target === els.togglePrivacy ||
    target === els.toggleDevtools ||
    target === els.vaultIndicator
  )
    return;
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
 * Toolbar-mode invocation: right-click a pinned toolbar icon (or the vault indicator,
 * squawk 0038 — not pinnable, same compact single-item menu), anchored at the button.
 * @param {'media'|'shields'|'devtools'|'vault'} item
 * @param {HTMLElement} anchorEl  the toolbar/indicator button that was right-clicked
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
    hasView: (tabs.get(id) || {}).wcId != null, // M16 F2 Leg 1 (DD7/DD8): no view → no dead move/duplicate controls
    // M09 F8 DD8: one flat "Move to window …" item per OTHER window. Push-cached
    // above, so this read stays synchronous.
    moveTargets: moveTargetsCache.get()
  });
  openOverlayMenu('tab-context', model, chromePointToSheet(r.left, r.bottom), 0);
}

// Mission 20 Flight 2 Leg 1 (DD11): the `open*ForAudit` hook family, extracted
// verbatim into audit-hooks.js (zero-headroom relief for this composition
// root) — bound here to the SAME names the seam tail below republishes, so
// SEAM_COUNT and the a11y audit's `open:` strings are untouched by the move.
const {
  openAuthBasicOverlayForAudit,
  openCertPickerOverlayForAudit,
  openBookmarkEditOverlayForAudit,
  openBookmarksOverflowOverlayForAudit,
  openCertOverrideOverlayForAudit,
  openCertViewerOverlayForAudit,
  openPageContextMenuForAudit,
  openTabContextMenuForAudit
} = createAuditHooks({
  openOverlayMenu,
  els,
  tabs,
  orderedTabIds,
  activeTab,
  chromePointToSheet,
  pageCtx,
  tabCtx,
  openPageContextOverlaySheet
});

/* ------------------------------------------------------------------ tabs */

/* ------------------------------------------------------------------- boot */
window.goldfinch.onOpenTab(({ url, openerPartition }) => {
  // Every open-tab arrives from a page's window.open (setWindowOpenHandler
  // deny-and-forward) — scriptOpened lets a later window.close() be honored (#119).
  createTab(url, jarsClient.inheritContainerFromPartition(openerPartition), { scriptOpened: true });
});

// ---------------------------------------------------------------------------
// Web tab event subscriptions (module-level, route by wcId to the correct tab)
// ---------------------------------------------------------------------------

window.goldfinch.onTabDidNavigate(({ wcId, url }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.url = url;
  [loadFailureController, hangNoticeController].forEach((c) => c.onTabDidNavigate(tab)); // HAT H2b
  if (tab.id === ctx.activeTabId) {
    els.address.value = tab.url;
    siteSecurityController.refreshTabIndicators(tab); // Mission 20 F3 Leg 1 (DD11): the single chip-refresh owner
    updateNavButtons();
    refreshStar(tab); // sync path 1/5 (M15 F1 Leg 2)
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
    siteSecurityController.refreshTabIndicators(tab); // Mission 20 F3 Leg 1 (DD11): the single chip-refresh owner
    updateNavButtons();
    refreshStar(tab); // sync path 2/5 (M15 F1 Leg 2)
    // Close trigger: navigation (in-page variant) of the active tab (flight DD5).
    closeSuggestions('navigation');
  }
});

// Guest self-close (#119): window.close() → preload shim → guest-window-close →
// tab-self-close. Chromium's close gate, replicated: honor a script-opened tab
// (onOpenTab above) or history ≤ 1; else silent no-op (same observable outcome
// as Chromium refusing). closeTab runs the full normal path — strip removal,
// closed-tab capture, never-zero-tabs fallback (last-tab self-close leaves a
// fresh tab, never a closed window).
window.goldfinch.onTabSelfClose(({ wcId, historyLength }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  if (tab.scriptOpened || historyLength <= 1) closeTab(tab.id);
});

window.goldfinch.onTabTitle(({ wcId, title }) => {
  const tab = findTabByWcId(wcId);
  if (!tab) return;
  tab.title = title;
  if (tab.loadFailure || tab.crash) return; // Mission 20 F1 L2 (AC5) / F3 L2 (DD1): a late/empty error-document title must not clobber the strip's host title.
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
  if (img) {
    img.src = fav;
    img.classList.remove('hidden');
  }
  // Icon passive refresh (M15 F1 Leg 2, DD6; jar-resolved M15 F2 Leg 3,
  // L3-DD-H/DD7b): resolves the DELIVERING tab's jar — never the active
  // tab's, this fires for background tabs too. A cache miss for that jar is
  // a SKIP, not an `ensureJar` trigger — a passive icon refresh must not
  // populate a cache for a jar the operator isn't looking at. A difference
  // guard prevents broadcast storms on routine navigation — only issue the
  // mutation when the cache holds a bookmark matching this tab's URL (in ITS
  // OWN jar) AND its stored icon actually differs from the freshly-delivered
  // one.
  const jarId = tab.container && tab.container.id;
  const bm = jarId != null ? bookmarksClient.findByUrl(jarId, tab.url) : null;
  if (bm && bm.icon !== fav) window.goldfinch.bookmarkUpdate({ jarId, id: bm.id, icon: fav });
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

// HTTP auth challenge + TLS client-cert challenge presentation (M14 F1 L2/L3) —
// both subscriptions now live in auth-challenge-controller.js (extracted M21 F3
// Leg 1, constructed above alongside vaultController).

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
  window.goldfinch.settingsGet('searchEngine').catch(() => null), // M16 F2 Leg 2 (DD5 [high]): awaited, not read from the racing live cache
  jarsClient.boot,
  // Boot-race gate (M15 F1 Leg 2, AC; narrowed M15 F2 Leg 3 L3-DD-B): joins
  // the barrier exactly as jarsClient.boot does, but now only guarantees the
  // DEFAULT jar's cache is warm by boot's end — the Flight 1 "first tab's
  // star renders only after the cache is populated" guarantee narrows to
  // first-sight-of-EACH-jar (DD6's honest bound), since the cache is per-jar
  // and jarsClient's own default id is unknowable until jarsClient.boot
  // resolves.
  bookmarksClient.boot,
  window.goldfinch.windowBootConfig().catch(
    () =>
      /** @type {{ bootTab: boolean, restoreTabs?: Array<{ url: string, jarId: string, active: boolean }> }} */ ({
        bootTab: true
      })
  )
]).then(([url, engine, , , bootConfig]) => {
  // Session restore (M09 F9 / DD4 / AC5; REWRITTEN M15 F1 DD10 Leg 1): CREATE each
  // saved tab FRESH in its saved jar — never adopt; MINUS restoreHistory/insertAt
  // (DD5); NEVER inheritContainerFromPartition (its default-jar fallback would
  // silently re-home a deleted jar tab, DD4) — resolveRestoreContainer maps the
  // saved jarId to a live jar, dropping (continue) an unresolvable one. Every create
  // now passes background:true (DD10): no more relying on serial self-activation —
  // the saved-active tab, or (Edge Case) the LAST created tab, activates once at the end.
  if (bootConfig && Array.isArray(bootConfig.restoreTabs) && bootConfig.restoreTabs.length) {
    let activeTab = null;
    let lastTab = null;
    for (const t of bootConfig.restoreTabs) {
      const container = resolveRestoreContainer(t.jarId, jarsClient.containers);
      if (!container) continue;
      const tab = createTab(t.url, container, { trusted: false, background: true });
      if (!tab) continue;
      lastTab = tab;
      if (t.active) activeTab = tab;
    }
    const toActivate = activeTab || lastTab;
    if (toActivate) activateTab(toActivate.id);
  } else if (!bootConfig || bootConfig.bootTab !== false) {
    // M16 F2 Leg 1/2 (DD4/DD9/DD7): unset home page → welcome surface.
    if (url == null) openWelcomeTab({ reasons: welcomeReasons(url, engine) });
    else createTab(url);
  }
});

// Mission 20 F3 Leg 2 (DD11 seam ruling): synthetic crash/hang records on the
// active tab for the a11y audit's two new chrome states. HAT H2b: cleared by
// the tab's next committed navigation (both controllers' onTabDidNavigate
// hooks, wired above) or a real push — the audit visits each state fresh.
function showCrashPanelForAudit() {
  const tab = activeTab();
  if (!tab || tab.wcId == null) return;
  tab.crash = { reason: 'crashed', exitCode: 139, url: tab.url };
  tab.loadFailure = null;
  tab.hung = false;
  loadFailureController.applyStripState(tab);
  loadFailureController.show(tab);
}
function showHangNoticeForAudit() {
  const tab = activeTab();
  if (!tab || tab.wcId == null) return;
  tab.hung = true;
  hangNoticeController.project(tab);
}

// ---------------------------------------------------------------------------
// Evaluate-reachable automation/dogfooding seam (M07 Flight 2 leg 5, FD-approved).
// This file is an ES module: its top-level functions are module-scoped, NOT
// page globals — but the evaluate-driven surfaces (chrome-tier `evaluate` in
// dogfooding/live-boot procedures, behavior-test specs under tests/behavior/,
// and scripts/a11y-audit.mjs) call these entry points by global name via
// `executeJavaScript`. This block republishes EXACTLY the FD-approved 36-entry
// set on globalThis, each tagged with its consumer class. It is NOT the
// classic-script shared-scope collision class (deliberate assignments from
// module scope, not top-level declares in a shared lexical scope). CLOSED SET:
// do not grow it without an FD ruling — an evaluate caller outside these 36 is
// a design change, not a seam addition. (M09 F5 Leg 1 FD ruling: added
// openTabContextMenuForAudit for the new sheet:tab-context a11y state — see
// the flight's Checkpoints. M11 F1 Leg 3 FD ruling: added
// showDownloadsIndicatorForAudit + openDownloadsOverlayForAudit for the new
// downloads-button + sheet:downloads a11y states. M12 F3 Leg 4: added
// openVaultSetOverlayForAudit + openVaultRecoveryShowOverlayForAudit for the
// sheet:vault-set / vault-recovery-show a11y states per the leg's DD9 SHEET_STATES
// deliverable. M12 F3 Leg 5: added openVaultStepupOverlayForAudit +
// openVaultAccessKeyShowOverlayForAudit for the sheet:vault-stepup /
// vault-accesskey-show a11y states. M12 F4 Legs 1-3: added
// openVaultImportUnlockOverlayForAudit, openVaultChangeMasterOverlayForAudit,
// openVaultRecoverOverlayForAudit + openVaultAdminKeyShowOverlayForAudit for the
// sheet:vault-import-unlock / vault-change-master / vault-recover / vault-adminkey-show
// a11y states. M14 F1 L2: added openAuthBasicOverlayForAudit for the
// sheet:auth-basic a11y state. M14 F1 L3: added openCertPickerOverlayForAudit
// for the sheet:cert-picker a11y state. M15 F1 Leg 2 FD ruling: added
// openBookmarkEditOverlayForAudit for the new sheet:bookmark-edit a11y state
// (the every-new-sheet precedent) — CLAUDE.md's dual-source note updated in
// the same change, per the flight-log FD ruling. M15 F1 Leg 3 FD ruling: added
// openBookmarksOverflowOverlayForAudit for the new sheet:bookmarks-overflow
// a11y state (32 → 33, same every-new-sheet precedent) — CLAUDE.md's
// dual-source note updated in the same change. M16 F2 Leg 1 FD ruling: added
// openNewTab (33 → 34, see its inline comment below) — CLAUDE.md's dual-source note updated too.
// M18 F2 L4: added openVaultCompromiseOverlayForAudit + openVaultCompromiseRecoverOverlayForAudit
// (34 → 36) for the sheet:vault-compromise / vault-compromise-recover a11y states — the
// every-new-sheet, leg-authorized precedent; CLAUDE.md's dual-source note updated in the same change.
// M20 F3 Leg 2 FD ruling: added showCrashPanelForAudit + showHangNoticeForAudit (39 → 41) for the
// new 'crashed'/'hung' chrome states (synthetic records on the active tab, the
// showDownloadsIndicatorForAudit precedent) — CLAUDE.md's dual-source note updated in the same change.)
Object.assign(/** @type {any} */ (globalThis), {
  // dogfooding (flight live-boot procedures, docs/mcp-automation.md)
  openJarsPage,
  kebabActionSettings,
  openContainerOverlay, // also driven by scripts/a11y-audit.mjs (SHEET_STATES 'sheet:container')
  // behavior-spec (tests/behavior/*.md drive these by name)
  createTab, // popup-jar-inheritance, jar-data-controls
  // M16 F2 Leg 1 FD ruling: welcome-home-routing step 5 drives the burner path through the same code the container menu runs
  openNewTab,
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
  showDownloadsIndicatorForAudit, // M11 F1 Leg 3 — chrome state 'downloads-button' (FD-ruled addition)
  openDownloadsOverlayForAudit, // M11 F1 Leg 3 — SHEET_STATES 'sheet:downloads' (FD-ruled addition)
  openVaultSetOverlayForAudit, // M12 F3 Leg 4 — SHEET_STATES 'sheet:vault-set' (DD9 addition)
  openVaultRecoveryShowOverlayForAudit, // M12 F3 Leg 4 — SHEET_STATES 'sheet:vault-recovery-show' (DD9 addition)
  openVaultStepupOverlayForAudit, // M12 F3 Leg 5 — SHEET_STATES 'sheet:vault-stepup' (DD9 addition)
  openVaultAccessKeyShowOverlayForAudit, // M12 F3 Leg 5 — SHEET_STATES 'sheet:vault-accesskey-show' (DD9 addition)
  openVaultImportUnlockOverlayForAudit, // M12 F4 Leg 1 — SHEET_STATES 'sheet:vault-import-unlock' (DD9 addition)
  openVaultChangeMasterOverlayForAudit, // M12 F4 Leg 2 — SHEET_STATES 'sheet:vault-change-master' (DD9 addition)
  openVaultRecoverOverlayForAudit, // M12 F4 Leg 2 — SHEET_STATES 'sheet:vault-recover' (DD9 addition)
  openVaultAdminKeyShowOverlayForAudit, // M12 F4 Leg 3 — SHEET_STATES 'sheet:vault-adminkey-show' (DD9 addition)
  openAuthBasicOverlayForAudit, // M14 F1 L2 — SHEET_STATES 'sheet:auth-basic' (leg-authorized addition)
  openCertPickerOverlayForAudit, // M14 F1 L3 — SHEET_STATES 'sheet:cert-picker' (leg-authorized addition)
  openBookmarkEditOverlayForAudit, // M15 F1 Leg 2 — SHEET_STATES 'sheet:bookmark-edit' (FD-ruled addition)
  openBookmarksOverflowOverlayForAudit, // M15 F1 Leg 3 — SHEET_STATES 'sheet:bookmarks-overflow' (FD-ruled addition)
  openVaultCompromiseOverlayForAudit, // M18 F2 L4 — SHEET_STATES 'sheet:vault-compromise' (leg-authorized addition)
  openVaultCompromiseRecoverOverlayForAudit, // M18 F2 L4 — SHEET_STATES 'sheet:vault-compromise-recover' (leg-authorized addition)
  openCertOverrideOverlayForAudit, // M20 F2 L3 — SHEET_STATES 'sheet:cert-override' (leg-authorized addition, SEAM_COUNT 36 → 37)
  openCertViewerOverlayForAudit, // M20 F2 L4 — SHEET_STATES 'sheet:cert-viewer' (leg-authorized addition, SEAM_COUNT 37 → 38)
  openCertificateViewer, // M20 F2 L4 — behavior-spec-driven opener (the M16 F2 L1 openNewTab precedent, SEAM_COUNT 38 → 39)
  showCrashPanelForAudit, // M20 F3 L2 — chrome state 'crashed' (FD-ruled addition, SEAM_COUNT 39 → 40)
  showHangNoticeForAudit // M20 F3 L2 — chrome state 'hung' (FD-ruled addition, SEAM_COUNT 40 → 41)
});
