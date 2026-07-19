// goldfinch://jars serves imports through an exact flat allowlist. These
// specifiers intentionally describe serving paths rather than disk paths.
// @ts-ignore — serving-path vs disk-path mismatch
import { BURNER } from './burner.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { buildJarPageModel, PALETTE, pickNewJarColor } from './jar-page-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { JAR_DATA_CLASSES } from './jar-data-classes.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { isSafeColor } from './safe-color.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { JAR_PANELS, panelForDataClass } from './jar-panel-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createHistoryPanel } from './jars-history-panel.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createCookiesPanel } from './jars-cookies-panel.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createSiteDataPanel } from './jars-sitedata-panel.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createJarTabs } from './jars-tabs.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createConfirmModal } from './jars-confirm-modal.js';
// @ts-ignore — serving-path vs disk-path mismatch
import {
  createPanelModeKey,
  exactHashTarget,
  normalizeDefaultId as normalizeDefaultIdValue,
  reconcileTransient,
  sectionSetKey,
  stateFromPayload
} from './jars-page-state.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createJarsNav } from './jars-nav-controller.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createJarsSections } from './jars-section-controller.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createJarsCreatePanel } from './jars-create-controller.js';

/**
 * Composition root for goldfinch://jars. State is broadcast-owned: mutation
 * results are only success/failure signals and never optimistic render data.
 */
(function () {
  const bridge = window.goldfinchInternal;
  if (!bridge) return;

  const sectionsEl = document.getElementById('jars-sections');
  const navEl = document.getElementById('jars-nav');
  const newBtn = document.getElementById('jars-new');
  const pageErrorEl = document.getElementById('jars-page-error');
  if (!sectionsEl || !navEl || !newBtn || !pageErrorEl) return;

  /** @type {{ containers: any[], defaultId: string|null }} */
  let state = { containers: [], defaultId: null };
  /** @type {{ mode: 'create'|'confirm'|null, rowId: string|null, action: string|null, draft: {name: string, color: string}|null }} */
  let ui = { mode: null, rowId: null, action: null, draft: null };
  let appliedInitialHash = false;
  /** @type {ReturnType<typeof createJarsSections>} */
  let sectionsController;

  const setPageError = (text) => { pageErrorEl.textContent = text; };
  const clearPageError = () => { pageErrorEl.textContent = ''; };

  const jarsNav = createJarsNav({
    document,
    Node,
    navEl,
    IntersectionObserver,
    isSafeColor,
    fallbackColor: '#9aa0ac',
    getSectionRefs: (rowId) => sectionsController?.getSectionRefs(rowId),
    sectionSetKey
  });

  sectionsController = createJarsSections({
    window,
    document,
    Node,
    bridge,
    sectionsEl,
    newBtn,
    isSafeColor,
    PALETTE,
    JAR_PANELS,
    panelForDataClass,
    JAR_DATA_CLASSES,
    createHistoryPanel,
    createCookiesPanel,
    createSiteDataPanel,
    createJarTabs,
    createConfirmModal,
    getContainers: () => state.containers,
    getUi: () => ui,
    setUi: (next) => { ui = next; },
    setPageError,
    clearPageError,
    requestRender: render
  });

  const createController = createJarsCreatePanel({
    window,
    document,
    bridge,
    sectionsEl,
    newBtn,
    isSafeColor,
    PALETTE,
    pickNewJarColor,
    createPanelModeKey,
    getContainers: () => state.containers,
    getUi: () => ui,
    setUi: (next) => { ui = next; },
    getSectionRefs: (rowId) => sectionsController.getSectionRefs(rowId),
    requestRender: render
  });

  function render() {
    const rows = buildJarPageModel(state.containers, state.defaultId);
    ui = reconcileTransient(ui, rows);
    jarsNav.render(rows);
    sectionsController.render(rows);
    createController.render(rows);
    jarsNav.observeSectionsIfChanged(rows);
    sectionsController.updateConfirm();
  }

  function trySelectHash() {
    sectionsController.trySelectHash(location.hash, exactHashTarget);
  }

  /** @param {{ containers?: any[], defaultId?: string|null }} payload */
  function applyState(payload) {
    state = stateFromPayload(state, payload);
    render();
    if (!appliedInitialHash) {
      appliedInitialHash = true;
      trySelectHash();
    }
  }

  const jarsChangedHandle = bridge.onJarsChanged((payload) => {
    if (payload && Array.isArray(payload.containers)) applyState(payload);
  });
  const historyChangedHandle = bridge.onHistoryChanged((payload) => {
    sectionsController.handleHistoryChanged(payload);
  });
  const jarDataChangedHandle = bridge.onJarDataChanged((payload) => {
    sectionsController.handleJarDataChanged(payload);
  });
  const hashChanged = () => trySelectHash();
  window.addEventListener('hashchange', hashChanged);

  Promise.all([bridge.jarsList(), bridge.jarsGetDefault()])
    .then(([containers, defaultJar]) => {
      applyState({
        containers: Array.isArray(containers) ? containers : [],
        defaultId: normalizeDefaultIdValue(defaultJar, BURNER.id)
      });
    })
    .catch(() => {});

  window.addEventListener('pagehide', () => {
    bridge.offJarsChanged(jarsChangedHandle);
    bridge.offHistoryChanged(historyChangedHandle);
    bridge.offJarDataChanged(jarDataChangedHandle);
    window.removeEventListener('hashchange', hashChanged);
    createController.destroy?.();
    sectionsController.destroy();
    jarsNav.destroy();
  }, { once: true });
})();
