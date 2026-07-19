export function createJarsSections(deps) {
  /** @typedef {{ id: string, name: string, color: string, isDefault: boolean, isBurner: boolean }} JarRow */
  const {
    window, document, Node, bridge, sectionsEl, newBtn,
    isSafeColor, PALETTE, JAR_PANELS, panelForDataClass, JAR_DATA_CLASSES,
    createHistoryPanel, createCookiesPanel, createSiteDataPanel,
    createJarTabs, createConfirmModal, getContainers, getUi, setUi,
    setPageError, clearPageError, requestRender
  } = deps;
  function currentRowFor(id) {
    return getContainers().find((container) => container.id === id) || null;
  }
  function closeTransient() {
    setUi({ mode: null, rowId: null, action: null, draft: null });
    requestRender();
  }
const FALLBACK_COLOR = '#9aa0ac';
const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * @param {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} shapes
 * @returns {SVGSVGElement}
 */
function buildIcon(shapes) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('jar-icon');
  for (const shape of shapes) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const key of Object.keys(shape.attrs)) el.setAttribute(key, shape.attrs[key]);
    svg.appendChild(el);
  }
  return svg;
}
/** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
const ICON_DELETE = [
  { tag: 'path', attrs: { d: 'M3 6h18' } },
  { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
  { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
  { tag: 'line', attrs: { x1: '10', x2: '10', y1: '11', y2: '17' } },
  { tag: 'line', attrs: { x1: '14', x2: '14', y1: '11', y2: '17' } }
];
/** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
const ICON_REFRESH = [
  { tag: 'path', attrs: { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' } },
  { tag: 'path', attrs: { d: 'M3 3v5h5' } },
  { tag: 'path', attrs: { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' } },
  { tag: 'path', attrs: { d: 'M16 16h5v5' } }
];
const RETENTION_PRESETS = Object.freeze([7, 14, 30, 90, 180, 365]);
/**
 * @param {HTMLSelectElement} select
 * @param {number} days
 */
function ensureRetentionOption(select, days) {
  const has = Array.from(select.options).some((opt) => Number(opt.value) === days);
  if (has) return;
  const opt = document.createElement('option');
  opt.value = String(days);
  opt.textContent = `${days} days`;
  select.appendChild(opt);
}
const DATA_STATUS_OK_TTL_MS = 4000;
/**
 * @param {SectionRefs} refs
 * @param {string} text
 * @param {boolean} ok
 */
function setSectionStatus(refs, text, ok) {
  if (refs.statusClearHandle != null) {
    clearTimeout(refs.statusClearHandle);
    refs.statusClearHandle = null;
  }
  refs.errorLine.textContent = text;
  refs.errorLine.classList.toggle('is-ok', ok);
  if (ok && text) {
    refs.statusClearHandle = window.setTimeout(() => {
      if (refs.errorLine.textContent === text) {
        refs.errorLine.textContent = '';
        refs.errorLine.classList.remove('is-ok');
      }
      refs.statusClearHandle = null;
    }, DATA_STATUS_OK_TTL_MS);
  }
}
/**
 * @param {readonly string[]} colors
 * @param {() => string} getSelected
 * @param {(color: string) => void} onSelect
 * @returns {HTMLElement}
 */
function buildSwatchGrid(colors, getSelected, onSelect) {
  const grid = document.createElement('div');
  grid.className = 'swatch-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Jar color');
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  function paint() {
    const selected = getSelected();
    for (const btn of buttons) {
      const checked = btn.dataset.color === selected;
      btn.setAttribute('aria-checked', String(checked));
      btn.classList.toggle('selected', checked);
    }
  }
  for (const color of colors) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch-btn';
    btn.dataset.color = color;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-label', color);
    btn.style.background = isSafeColor(color) ? color : FALLBACK_COLOR;
    btn.addEventListener('click', () => {
      onSelect(color);
      paint();
    });
    buttons.push(btn);
    grid.appendChild(btn);
  }
  paint();
  return grid;
}
/**
 * @param {HTMLElement|null} gridEl
 * @param {string} selectedColor
 */
function syncSwatchSelection(gridEl, selectedColor) {
  if (!gridEl) return;
  const buttons = gridEl.querySelectorAll('.swatch-btn');
  for (const btn of buttons) {
    const checked = /** @type {HTMLElement} */ (btn).dataset.color === selectedColor;
    btn.setAttribute('aria-checked', String(checked));
    btn.classList.toggle('selected', checked);
  }
}
/**
 * @param {string} currentColor
 * @returns {readonly string[]}
 */
function editColors(currentColor) {
  return PALETTE.includes(currentColor) ? PALETTE : [...PALETTE, currentColor];
}
/**
 * @typedef {{
 *   root: HTMLElement, isBurner: boolean, row: (JarRow|null),
 *   dot: HTMLElement, h2: HTMLElement, pill: HTMLElement,
 *   nameInput?: HTMLInputElement, swatchContainer?: HTMLElement,
 *   swatchGrid?: (HTMLElement|null), errorLine?: HTMLElement,
 *   makeDefaultBtn?: HTMLButtonElement, pendingColor?: (string|null),
 *   dataButtons?: Map<string, HTMLButtonElement>,
 *   activeTab?: string,
 *   tabRefs?: Map<string, { tab: HTMLButtonElement, panel: HTMLElement, countSpan: HTMLElement }>,
 *   activationHooks?: Map<string, () => void>,
 *   statusClearHandle?: (number|null), nameDirty?: boolean,
 *   retentionSelect?: HTMLSelectElement, lastKnownRetention?: number,
 *   historyPanel?: ({ onExpanded: () => void, onHistoryChanged: () => void, destroy: () => void } | null),
 *   cookiesPanel?: ({ onActivated: () => void, onJarDataChanged: () => void, refresh: () => void, destroy: () => void } | null),
 *   siteDataPanel?: ({ onActivated: () => void, onJarDataChanged: () => void, refresh: () => void, destroy: () => void } | null)
 * }} SectionRefs
 */
/** @type {Map<string, SectionRefs>} */
const sectionMap = new Map();
/**
 * @returns {{ root: HTMLElement, buttonRow: HTMLElement }}
 */
function buildRegionControls() {
  const root = document.createElement('div');
  root.className = 'jar-data-controls';
  const buttonRow = document.createElement('div');
  buttonRow.className = 'jar-data-controls-buttons';
  root.appendChild(buttonRow);
  return { root, buttonRow };
}
/**
 * @param {JarRow} row
 * @returns {HTMLButtonElement}
 */
function buildDeleteButton(row) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jar-btn jar-btn-danger jar-btn-icon-label';
  btn.appendChild(buildIcon(ICON_DELETE));
  btn.appendChild(document.createTextNode('Delete jar…'));
  btn.setAttribute('aria-label', `Delete ${row.name}`);
  btn.addEventListener('click', () => openDataConfirm(row.id, 'delete'));
  return btn;
}
/**
 * @param {() => void} onRefresh
 * @returns {HTMLButtonElement}
 */
function buildPanelRefreshButton(onRefresh) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jar-btn jar-datalist-refresh';
  btn.appendChild(buildIcon(ICON_REFRESH));
  btn.setAttribute('aria-label', 'Refresh');
  btn.addEventListener('click', () => onRefresh());
  return btn;
}
const jarTabs = createJarTabs({ panels: JAR_PANELS });
/**
 * @param {JarRow} row
 * @returns {SectionRefs}
 */
function buildJarSection(row) {
  const section = document.createElement('section');
  section.id = 'jar-' + row.id;
  section.className = 'jar-section';
  const header = document.createElement('div');
  header.className = 'jar-section-header';
  const dot = document.createElement('span');
  dot.className = 'jar-dot';
  header.appendChild(dot);
  const h2 = document.createElement('h2');
  header.appendChild(h2);
  const pill = document.createElement('span');
  pill.className = 'jar-badge';
  pill.textContent = 'Default';
  header.appendChild(pill);
  const makeDefaultBtn = document.createElement('button');
  makeDefaultBtn.type = 'button';
  makeDefaultBtn.className = 'jar-btn jar-btn-compact';
  makeDefaultBtn.textContent = 'Make default';
  header.appendChild(makeDefaultBtn);
  const retentionWrap = document.createElement('div');
  retentionWrap.className = 'jar-section-retention';
  const retentionSelectId = 'jar-' + row.id + '-retention';
  const retentionLabel = document.createElement('label');
  retentionLabel.className = 'jar-section-retention-label';
  retentionLabel.htmlFor = retentionSelectId;
  retentionLabel.textContent = 'Keep data for:';
  retentionWrap.appendChild(retentionLabel);
  const retentionSelect = document.createElement('select');
  retentionSelect.id = retentionSelectId;
  retentionSelect.className = 'jar-section-retention-select';
  retentionSelect.setAttribute('aria-label', `Keep data for (${row.name})`);
  for (const preset of RETENTION_PRESETS) {
    const opt = document.createElement('option');
    opt.value = String(preset);
    opt.textContent = `${preset} days`;
    retentionSelect.appendChild(opt);
  }
  const initialRetention = currentRowFor(row.id)?.retentionDays ?? 30;
  ensureRetentionOption(retentionSelect, initialRetention);
  retentionSelect.value = String(initialRetention);
  retentionWrap.appendChild(retentionSelect);
  header.appendChild(retentionWrap);
  section.appendChild(header);
  const nameLabel = document.createElement('label');
  nameLabel.className = 'jar-form-label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'jar-name-input';
  nameInput.maxLength = 24;
  nameInput.setAttribute('aria-label', 'Jar name');
  nameLabel.appendChild(nameInput);
  section.appendChild(nameLabel);
  const swatchContainer = document.createElement('div');
  swatchContainer.className = 'swatch-grid-container';
  section.appendChild(swatchContainer);
  const errorLine = document.createElement('p');
  errorLine.className = 'jar-error-line';
  errorLine.setAttribute('aria-live', 'polite');
  section.appendChild(errorLine);
  /** @type {Map<string, HTMLButtonElement>} */
  const dataButtons = new Map();
  /** @type {Map<string, HTMLElement>} */
  const panelButtonRows = new Map();
  /** @type {Map<string, HTMLButtonElement>} */
  const panelRefreshButtons = new Map();
  /** @type {SectionRefs} */
  let refs;
  /** @type {{ onExpanded: () => void, onHistoryChanged: () => void, destroy: () => void } | null} */
  let historyPanel = null;
  /** @type {{ onActivated: () => void, onJarDataChanged: () => void, refresh: () => void, destroy: () => void } | null} */
  let cookiesPanel = null;
  /** @type {{ onActivated: () => void, onJarDataChanged: () => void, refresh: () => void, destroy: () => void } | null} */
  let siteDataPanel = null;
  /**
   * @param {string} panelId
   * @param {HTMLElement} panelEl
 */
  function buildPanelContent(panelId, panelEl) {
    const controls = buildRegionControls();
    panelButtonRows.set(panelId, controls.buttonRow);
    panelEl.appendChild(controls.root);
    if (panelId === 'history') {
      const historyMount = document.createElement('div');
      historyMount.className = 'jar-history-mount';
      panelEl.appendChild(historyMount);
      historyPanel = createHistoryPanel({
        bridge,
        jarId: row.id,
        mountEl: historyMount,
        onError: (message) => setSectionStatus(refs, message, false),
        onPageChange: () => refs.root.scrollIntoView({ block: 'start' })
      });
    } else if (panelId === 'cookies') {
      const cookiesMount = document.createElement('div');
      cookiesMount.className = 'jar-cookies-mount';
      panelEl.appendChild(cookiesMount);
      cookiesPanel = createCookiesPanel({
        bridge,
        jarId: row.id,
        mountEl: cookiesMount,
        onError: (message) => setSectionStatus(refs, message, false),
        onCountChanged: (count) => updateTabCount(refs, 'cookies', count)
      });
      panelRefreshButtons.set('cookies', buildPanelRefreshButton(() => cookiesPanel?.refresh()));
    } else if (panelId === 'site-data') {
      const siteDataMount = document.createElement('div');
      siteDataMount.className = 'jar-sitedata-mount';
      panelEl.appendChild(siteDataMount);
      siteDataPanel = createSiteDataPanel({
        bridge,
        jarId: row.id,
        mountEl: siteDataMount,
        onError: (message) => setSectionStatus(refs, message, false),
        onCountChanged: (count) => updateTabCount(refs, 'site-data', count)
      });
      panelRefreshButtons.set('site-data', buildPanelRefreshButton(() => siteDataPanel?.refresh()));
    }
  }
  const { tabsWrap, tabRefs } = jarTabs.build(row, { getRefs: () => refs, buildPanelContent });
  section.appendChild(tabsWrap);
  /** @type {Map<string, () => void>} */
  const activationHooks = new Map([
    ['history', () => historyPanel?.onExpanded()],
    ['cookies', () => cookiesPanel?.onActivated()],
    ['site-data', () => siteDataPanel?.onActivated()]
  ]);
  for (const cls of JAR_DATA_CLASSES) {
    const panelId = panelForDataClass(cls.id);
    const buttonRow = panelId ? panelButtonRows.get(panelId) : null;
    if (!buttonRow) continue; // fail-closed: an unrouted class renders no control
    const action = 'clear-' + cls.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jar-btn';
    btn.textContent = `Clear ${cls.label.toLowerCase()}`;
    btn.addEventListener('click', () => openDataConfirm(row.id, action));
    dataButtons.set(action, btn);
    buttonRow.appendChild(btn);
  }
  for (const [panelId, refreshBtn] of panelRefreshButtons) {
    const buttonRow = panelButtonRows.get(panelId);
    if (buttonRow) buttonRow.appendChild(refreshBtn);
  }
  const footer = document.createElement('div');
  footer.className = 'jar-section-footer';
  const footerControls = buildRegionControls();
  const wipeBtn = document.createElement('button');
  wipeBtn.type = 'button';
  wipeBtn.className = 'jar-btn jar-btn-danger';
  wipeBtn.textContent = 'Clear identity';
  wipeBtn.addEventListener('click', () => openDataConfirm(row.id, 'wipe'));
  dataButtons.set('wipe', wipeBtn);
  footerControls.buttonRow.appendChild(wipeBtn);
  const deleteBtn = buildDeleteButton(row);
  dataButtons.set('delete', deleteBtn);
  footerControls.buttonRow.appendChild(deleteBtn);
  footer.appendChild(footerControls.root);
  section.appendChild(footer);
  refs = {
    root: section,
    isBurner: false,
    row: null,
    dot,
    h2,
    pill,
    nameInput,
    swatchContainer,
    swatchGrid: null,
    errorLine,
    makeDefaultBtn,
    pendingColor: null,
    dataButtons,
    activeTab: 'history',
    tabRefs,
    activationHooks,
    statusClearHandle: null,
    nameDirty: false,
    retentionSelect,
    lastKnownRetention: initialRetention,
    historyPanel,
    cookiesPanel,
    siteDataPanel
  };
  makeDefaultBtn.addEventListener('click', () => handleSetDefault(row.id));
  retentionSelect.addEventListener('change', () => {
    const days = Number(retentionSelect.value);
    const prior = refs.lastKnownRetention ?? days;
    refs.lastKnownRetention = days;
    bridge
      .jarsSetRetention({ id: row.id, days })
      .then((result) => {
        if (!result || !result.ok) {
          refs.lastKnownRetention = prior;
          retentionSelect.value = String(prior);
          setSectionStatus(refs, 'Could not update retention', false);
        }
      })
      .catch(() => {
        refs.lastKnownRetention = prior;
        retentionSelect.value = String(prior);
        setSectionStatus(refs, 'Could not update retention', false);
      });
  });
  nameInput.addEventListener('input', () => {
    refs.nameDirty = true;
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      nameInput.value = refs.row ? refs.row.name : '';
      refs.nameDirty = false;
      nameInput.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault(); // never submit/navigate
      commitOrRevertName(row.id, refs);
    }
  });
  nameInput.addEventListener('blur', () => commitOrRevertName(row.id, refs));
  updateJarSection(refs, row);
  for (const panel of JAR_PANELS) {
    const tabRef = tabRefs.get(panel.id);
    if (!tabRef || !tabRef.countSpan) continue;
    if (panel.id === 'history') fetchHistoryCount(row.id, tabRef.countSpan);
    else if (panel.id === 'cookies') fetchCookiesCount(row.id, tabRef.countSpan);
    else if (panel.id === 'site-data') fetchSiteDataCount(row.id, tabRef.countSpan);
  }
  return refs;
}
/**
 * @param {SectionRefs} refs
 * @param {JarRow} row
 */
function updateJarSection(refs, row) {
  refs.row = row;
  refs.dot.style.background = isSafeColor(row.color) ? row.color : FALLBACK_COLOR;
  refs.h2.textContent = row.name;
  refs.pill.hidden = !row.isDefault;
  refs.makeDefaultBtn.hidden = row.isDefault;
  refs.makeDefaultBtn.setAttribute('aria-label', `Make ${row.name} the default jar`);
  if (document.activeElement !== refs.nameInput) {
    refs.nameInput.value = row.name;
  }
  refs.nameInput.setAttribute('aria-label', `Name for ${row.name}`);
  if (refs.retentionSelect) refs.retentionSelect.setAttribute('aria-label', `Keep data for (${row.name})`);
  updateSwatchGrid(refs, row);
  updateSectionRetention(refs, row.id);
}
/**
 * @param {SectionRefs} refs
 * @param {string} id
 */
function updateSectionRetention(refs, id) {
  const select = refs.retentionSelect;
  if (!select) return; // Burner has no retention control
  if (document.activeElement === select) return;
  const days = currentRowFor(id)?.retentionDays ?? 30;
  if (days === refs.lastKnownRetention) return;
  ensureRetentionOption(select, days);
  select.value = String(days);
  refs.lastKnownRetention = days;
}
/**
 * @param {SectionRefs} refs
 * @param {JarRow} row
 */
function updateSwatchGrid(refs, row) {
  const focused = refs.swatchGrid instanceof Node && refs.swatchGrid.contains(document.activeElement);
  if (focused) {
    syncSwatchSelection(refs.swatchGrid, refs.pendingColor != null ? refs.pendingColor : row.color);
    return;
  }
  const grid = buildSwatchGrid(
    editColors(row.color),
    () => (refs.pendingColor != null ? refs.pendingColor : (refs.row ? refs.row.color : row.color)),
    (color) => handleColorSelect(refs, row.id, color)
  );
  refs.swatchContainer.textContent = '';
  refs.swatchContainer.appendChild(grid);
  refs.swatchGrid = grid;
}
/**
 * @param {SectionRefs} refs
 * @param {string} id
 * @param {string} color
 */
function handleColorSelect(refs, id, color) {
  refs.pendingColor = color;
  bridge.jarsRename({ id, color })
    .then((result) => {
      refs.pendingColor = null;
      if (!result) {
        setSectionStatus(refs, "Couldn't update jar", false);
        syncSwatchSelection(refs.swatchGrid, refs.row ? refs.row.color : color);
        return;
      }
      setSectionStatus(refs, '', false);
    })
    .catch(() => {
      refs.pendingColor = null;
      setSectionStatus(refs, "Couldn't update jar", false);
      syncSwatchSelection(refs.swatchGrid, refs.row ? refs.row.color : color);
    });
}
/**
 * @param {string} id
 * @param {SectionRefs} refs
 */
function commitOrRevertName(id, refs) {
  const inputEl = refs.nameInput;
  const storeName = refs.row ? refs.row.name : '';
  if (!refs.nameDirty) {
    inputEl.value = storeName;
    return;
  }
  const trimmed = inputEl.value.trim();
  if (trimmed === '' || trimmed === storeName) {
    inputEl.value = storeName;
    refs.nameDirty = false;
    return;
  }
  bridge.jarsRename({ id, name: trimmed })
    .then((result) => {
      refs.nameDirty = false;
      if (!result) {
        setSectionStatus(refs, "Couldn't update jar", false);
        if (document.activeElement !== inputEl) inputEl.value = refs.row ? refs.row.name : storeName;
        return;
      }
      setSectionStatus(refs, '', false);
    })
    .catch(() => {
      refs.nameDirty = false;
      setSectionStatus(refs, "Couldn't update jar", false);
      if (document.activeElement !== inputEl) inputEl.value = refs.row ? refs.row.name : storeName;
    });
}
const CLEAR_COPY = {
  cookies: "Clears this jar's cookies. Sites in this jar will sign you out.",
  storage: "Clears this jar's site storage — data sites saved locally in this jar.",
  cache: "Clears this jar's cached files. Sites reload them on next visit.",
  history: "Clears this jar's browsing history."
};
const CLEAR_OK_NOTE = {
  cookies: 'Cookies cleared.',
  storage: 'Site storage cleared.',
  cache: 'Cache cleared.',
  history: 'History cleared.'
};
const WIPE_COPY =
  "Wipes this jar's cookies, site storage, and cache, and rerolls its fingerprint. Open tabs in this jar will close.";
const WIPE_OK_NOTE = 'Identity cleared — data wiped, fingerprint rerolled.';
const DELETE_COPY = 'Deletes this jar and wipes its cookies, site storage, and cache. Open tabs in this jar will close.';
/**
 * @type {{ [action: string]: { copy: string, run: (id: string) => Promise<any>, okNote: string, failNote: string, silentSuccess?: boolean } }}
 */
const DATA_ACTIONS = {};
for (const cls of JAR_DATA_CLASSES) {
  DATA_ACTIONS['clear-' + cls.id] = {
    copy: CLEAR_COPY[cls.id],
    run: (id) => bridge.jarsClearData({ id, classes: [cls.id] }),
    okNote: CLEAR_OK_NOTE[cls.id],
    failNote: "Couldn't clear data"
  };
}
DATA_ACTIONS.wipe = {
  copy: WIPE_COPY,
  run: (id) => bridge.jarsWipe({ id }),
  okNote: WIPE_OK_NOTE,
  failNote: "Couldn't wipe jar"
};
DATA_ACTIONS.delete = {
  copy: DELETE_COPY,
  run: (id) => bridge.jarsRemove({ id }),
  okNote: '',
  failNote: "Couldn't delete jar",
  silentSuccess: true
};
/** @type {{ [action: string]: string }} */
const CONFIRM_TITLE = {};
for (const cls of JAR_DATA_CLASSES) {
  CONFIRM_TITLE['clear-' + cls.id] = `Clear ${cls.label.toLowerCase()}?`;
}
CONFIRM_TITLE.wipe = 'Clear identity?';
CONFIRM_TITLE.delete = 'Delete jar?';
const confirmModal = createConfirmModal({
  dataActions: DATA_ACTIONS,
  titles: CONFIRM_TITLE,
  getUi,
  closeTransient,
  getSectionRefs: (rowId) => sectionMap.get(rowId),
  setSectionStatus,
  fallbackFocusEl: newBtn
});
/** @param {string} id @param {string} action */
function openDataConfirm(id, action) {
  confirmModal.captureTrigger();
  setUi({ mode: 'confirm', rowId: id, action, draft: null });
  requestRender();
}
/**
 * @param {number} count
 * @returns {string}
 */
function tabCountSuffix(count) {
  return ` (${count})`;
}
/**
 * @param {string} jarId
 * @param {HTMLElement} countSpan
 */
function fetchHistoryCount(jarId, countSpan) {
  try {
    bridge.historyCount({ jarId })
      .then((result) => {
        if (result && result.ok) countSpan.textContent = tabCountSuffix(result.count);
      })
      .catch(() => {
      });
  } catch {
    // Optional bridge call during teardown.
  }
}
/**
 * @param {string} jarId
 * @param {HTMLElement} countSpan
 */
function fetchCookiesCount(jarId, countSpan) {
  try {
    bridge.jarsCookiesList({ id: jarId })
      .then((result) => {
        if (!result || !result.ok) return;
        const count = Array.isArray(result.cookies) ? result.cookies.length : 0;
        countSpan.textContent = tabCountSuffix(count);
      })
      .catch(() => {
      });
  } catch {
    // Optional bridge call during teardown.
  }
}
/**
 * @param {string} jarId
 * @param {HTMLElement} countSpan
 */
function fetchSiteDataCount(jarId, countSpan) {
  try {
    bridge.jarsSiteDataList({ id: jarId })
      .then((result) => {
        if (!result || !result.ok) return;
        const count = Array.isArray(result.origins) ? result.origins.length : 0;
        countSpan.textContent = tabCountSuffix(count);
      })
      .catch(() => {
      });
  } catch {
    // Optional bridge call during teardown.
  }
}
/**
 * @param {SectionRefs} refs
 * @param {string} panelId
 * @param {number} count
 */
function updateTabCount(refs, panelId, count) {
  const tabRef = refs.tabRefs?.get(panelId);
  if (tabRef && tabRef.countSpan) tabRef.countSpan.textContent = tabCountSuffix(count);
}
/**
 * @param {JarRow} row
 * @returns {SectionRefs}
 */
function buildBurnerSection(row) {
  const section = document.createElement('section');
  section.id = 'jar-' + row.id;
  section.className = 'jar-section jar-section-burner';
  const header = document.createElement('div');
  header.className = 'jar-section-header';
  const dot = document.createElement('span');
  dot.className = 'jar-dot';
  header.appendChild(dot);
  const h2 = document.createElement('h2');
  header.appendChild(h2);
  const pill = document.createElement('span');
  pill.className = 'jar-badge';
  pill.textContent = 'Default';
  header.appendChild(pill);
  section.appendChild(header);
  const hint = document.createElement('p');
  hint.className = 'jar-burner-hint';
  hint.textContent = 'Burner is always available and keeps no history — its tabs evaporate on close.';
  section.appendChild(hint);
  /** @type {SectionRefs} */
  const refs = { root: section, isBurner: true, row: null, dot, h2, pill };
  updateBurnerSection(refs, row);
  return refs;
}
/**
 * @param {SectionRefs} refs
 * @param {JarRow} row
 */
function updateBurnerSection(refs, row) {
  refs.row = row;
  refs.dot.style.background = isSafeColor(row.color) ? row.color : FALLBACK_COLOR;
  refs.h2.textContent = row.name;
  refs.pill.hidden = !row.isDefault;
}
/**
 * @param {JarRow[]} rows
 */
function renderSections(rows) {
  const rowIds = new Set(rows.map((r) => r.id));
  for (const id of Array.from(sectionMap.keys())) {
    if (!rowIds.has(id)) {
      const removed = sectionMap.get(id);
      if (removed.statusClearHandle != null) clearTimeout(removed.statusClearHandle);
      removed.historyPanel?.destroy();
      removed.cookiesPanel?.destroy();
      removed.siteDataPanel?.destroy();
      removed.root.remove();
      sectionMap.delete(id);
    }
  }
  let prevEl = null;
  for (const row of rows) {
    let refs = sectionMap.get(row.id);
    if (!refs) {
      refs = row.isBurner ? buildBurnerSection(row) : buildJarSection(row);
      sectionMap.set(row.id, refs);
    } else if (row.isBurner) {
      updateBurnerSection(refs, row);
    } else {
      updateJarSection(refs, row);
    }
    if (row.isBurner) {
      if (sectionsEl.lastChild !== refs.root) sectionsEl.appendChild(refs.root);
    } else if (prevEl == null) {
      if (sectionsEl.firstChild !== refs.root) sectionsEl.insertBefore(refs.root, sectionsEl.firstChild);
    } else if (prevEl.nextSibling !== refs.root) {
      sectionsEl.insertBefore(refs.root, prevEl.nextSibling);
    }
    prevEl = refs.root;
  }
}
/** @param {string} id */
function handleSetDefault(id) {
  clearPageError();
  bridge.jarsSetDefault({ id })
    .then((ok) => {
      if (!ok) setPageError("Couldn't set default jar");
    })
    .catch(() => setPageError("Couldn't set default jar"));
}
function trySelectHash(hash, exactHashTarget) {
  const targetId = exactHashTarget(hash, new Set(Array.from(sectionMap.values()).flatMap((refs) =>
    refs.tabRefs ? Array.from(refs.tabRefs.values()).map((tabRef) => tabRef.panel.id) : []
  )));
  if (!targetId) return;
  const el = document.getElementById(targetId);
  if (!el || !el.classList.contains('jar-tabpanel')) return;
  for (const refs of sectionMap.values()) {
    if (refs.isBurner || !refs.tabRefs) continue;
    for (const [panelId, tabRef] of refs.tabRefs) {
      if (tabRef.panel === el) {
        jarTabs.selectTab(refs, panelId);
        refs.root.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  }
}
function handleHistoryChanged(payload) {
  if (!payload || typeof payload.jarId !== 'string') return;
  const refs = sectionMap.get(payload.jarId);
  if (!refs || refs.isBurner) return;
  refs.historyPanel?.onHistoryChanged();
  const countSpan = refs.tabRefs?.get('history')?.countSpan;
  if (countSpan) fetchHistoryCount(payload.jarId, countSpan);
}
function handleJarDataChanged(payload) {
  if (!payload || typeof payload.jarId !== 'string') return;
  const refs = sectionMap.get(payload.jarId);
  if (!refs || refs.isBurner) return;
  refs.cookiesPanel?.onJarDataChanged();
  refs.siteDataPanel?.onJarDataChanged();
  if (!refs.tabRefs) return;
  const touchedPanels = new Set();
  for (const classId of Array.isArray(payload.classes) ? payload.classes : []) {
    const panelId = panelForDataClass(classId);
    if (panelId) touchedPanels.add(panelId);
  }
  for (const panelId of touchedPanels) {
    if (panelId === 'history' || refs.activeTab === panelId) continue;
    const countSpan = refs.tabRefs.get(panelId)?.countSpan;
    if (!countSpan) continue;
    if (panelId === 'cookies') fetchCookiesCount(payload.jarId, countSpan);
    else if (panelId === 'site-data') fetchSiteDataCount(payload.jarId, countSpan);
  }
}
function destroy() {
  for (const refs of sectionMap.values()) {
    if (refs.statusClearHandle != null) clearTimeout(refs.statusClearHandle);
    refs.historyPanel?.destroy();
    refs.cookiesPanel?.destroy();
    refs.siteDataPanel?.destroy();
  }
  sectionMap.clear();
}
return {
  render: renderSections,
  updateConfirm: () => confirmModal.update(),
  getSectionRefs: (rowId) => sectionMap.get(rowId),
  trySelectHash,
  handleHistoryChanged,
  handleJarDataChanged,
  destroy
};
}
