// @ts-check

/**
 * jars-tabs.js — the per-jar WAI-ARIA tab widget for goldfinch://jars (H4,
 * M08 Flight 6 Leg 3). Growth-checkpoint extraction (leg spec, pre-agreed,
 * not a re-litigation): landing the tab widget inline in jars.js crossed the
 * ~1,800-line DD2 trigger, so it moves here — the `jars-history-panel.js`
 * three-point-onboarding precedent (a new `jars.html` module `<script>` tag,
 * a new `INTERNAL_PAGES.jars` pathname entry in `main.js`, and the
 * `jars-page-shared-scripts.test.js` contract test self-deriving from
 * `jars.html` — no test-file edit needed).
 *
 * jars.js builds ONE tab widget per persistent jar's section and delegates
 * every tablist/roving-keydown/select concern to it; jars.js itself keeps
 * only the per-tabpanel CONTENT (the data-controls block + confirm area,
 * and the History mount) via the `buildPanelContent` callback passed to
 * `build()` — this module never reaches jars.js's confirm-area/history-mount
 * internals, and never renders anything inside a tabpanel beyond the shell.
 *
 * Host coupling (Electron-free injected-deps pattern, CLAUDE.md "Recurring
 * module shapes"): this module has no access to jars.js's page-level `ui`
 * singleton, so — for the one remaining consumer, the lazy-history-fetch
 * trigger — nothing needs to be injected at all; `selectTab` reads only the
 * duck-typed `refs` it's handed.
 *
 * **Confirm-close-on-switch branch RETIRED (M08 Flight 6 Leg 5, design
 * review, HIGH)**: `selectTab` used to close an open per-region confirm when
 * switching away from the region that owned it (`getUi`/`closeTransient`/
 * `regionForAction`, injected at construction). Leg 5 replaced the
 * per-region inline confirms with ONE page-level modal that focus-traps and
 * blocks tab-strip interaction while open — a tab switch can no longer
 * happen while a confirm is open, so the branch is dead by construction.
 * `createJarTabs()` now takes only `{ panels }`; `build`/`selectTab` no
 * longer take or read `getUi`/`closeTransient`/`regionForAction`.
 *
 * `createJarTabs()` returns `{ build, selectTab }`:
 * - `build(row, { getRefs, buildPanelContent })` constructs one section's
 *   `<div class="jar-tabs">` (tablist + N tabpanel shells, History
 *   default-selected) and wires tab click + the local roving-tabindex
 *   keydown handler (design review, HIGH: `menu-controller.js` is NOT
 *   loaded by `jars.html` and its ArrowUp/Down + open/close/return-focus
 *   semantics don't fit a persistent horizontal tablist — this module never
 *   reuses it). `getRefs()` is a thunk resolving to the CALLER's current
 *   `SectionRefs`-shaped object (jars.js passes `() => refs`, mirroring the
 *   forward-declared-`refs` pattern `jars-history-panel.js` already
 *   established: the closures below are never invoked until after the
 *   caller's own build function returns and assigns `refs`).
 * - `selectTab(refs, panelId)` is the ONE shared tab-switch path — used by
 *   tab click, this module's own roving keydown handler, AND jars.js's hash
 *   deep-link (design review, HIGH: a second inline implementation anywhere
 *   would bypass the never-strand-focus rule below). It reads `refs`
 *   duck-typed (`activeTab`, `tabRefs`, `row`, `historyPanel` — the same
 *   fields jars.js's `SectionRefs` already carries) so this module stays
 *   decoupled from jars.js's full type. No content rebuild on switch (the
 *   F2 toggle discipline, carried to tabs) — only `aria-selected`/
 *   `tabindex`/`hidden` flip on the same live nodes.
 *
 * Never-strand-focus-on-`<body>` rule (design review, MEDIUM-HIGH): a
 * focused control inside the outgoing tabpanel silently loses focus once
 * that panel goes `hidden` (Chromium moves `document.activeElement` to
 * `<body>` when a focused element's ancestor is hidden). After flipping
 * `hidden`, if focus was inside the panel that just hid (captured BEFORE
 * the flip) or has already landed on `<body>` (e.g. an initial-boot hash
 * switch, before anything has ever been focused), focus moves to the
 * newly-selected tab. A tab CLICK needs no special case — the browser
 * already focused the clicked tab button before its handler runs, so
 * neither condition fires and the extra `.focus()` call is simply skipped.
 *
 * Lazy history fetch (design review): `selectTab` fires
 * `refs.historyPanel?.onExpanded()` whenever the History tab becomes
 * selected — a direct switch (click/keyboard/hash) reaching History before
 * the section has ever intersected the viewport must still trigger the
 * fetch. `onExpanded`'s own `if (initialFetchStarted) return;` guard (in
 * `jars-history-panel.js`) is source-agnostic, so this stays idempotent
 * alongside jars.js's OTHER trigger — the scroll-into-view
 * `IntersectionObserver` (`observeSectionsIfChanged`), which fires the same
 * hook independently for a section that's on-screen at build time.
 */

/**
 * @param {{
 *   panels: ReadonlyArray<{ id: string, label: string }>
 * }} deps
 * @returns {{
 *   build: (row: { id: string }, opts: { getRefs: () => any, buildPanelContent: (panelId: string, panelEl: HTMLElement) => void }) => { tabsWrap: HTMLElement, tabRefs: Map<string, { tab: HTMLButtonElement, panel: HTMLElement, countSpan?: HTMLElement }> },
 *   selectTab: (refs: any, panelId: string) => void
 * }}
 */
export function createJarTabs({ panels }) {
  /**
   * @param {any} refs
   * @param {string} panelId
   */
  function selectTab(refs, panelId) {
    if (!refs.tabRefs || !refs.tabRefs.has(panelId) || refs.activeTab === panelId) return;
    const prevId = refs.activeTab;
    const prevRef = prevId ? refs.tabRefs.get(prevId) : null;
    const focusWasInOldPanel = !!(prevRef && prevRef.panel.contains(document.activeElement));

    refs.activeTab = panelId;
    for (const [id, ref] of refs.tabRefs) {
      const selected = id === panelId;
      ref.tab.setAttribute('aria-selected', String(selected));
      ref.tab.tabIndex = selected ? 0 : -1;
      ref.panel.hidden = !selected;
    }

    if (focusWasInOldPanel || document.activeElement === document.body) {
      refs.tabRefs.get(panelId)?.tab.focus();
    }

    if (panelId === 'history') refs.historyPanel?.onExpanded();
  }

  /**
   * @param {{ id: string }} row
   * @param {{ getRefs: () => any, buildPanelContent: (panelId: string, panelEl: HTMLElement) => void }} opts
   */
  function build(row, { getRefs, buildPanelContent }) {
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'jar-tabs';

    const tablist = document.createElement('div');
    tablist.className = 'jar-tablist';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Jar data');
    tabsWrap.appendChild(tablist);

    /** @type {Map<string, { tab: HTMLButtonElement, panel: HTMLElement, countSpan?: HTMLElement }>} */
    const tabRefs = new Map();

    // ⚠ DOUBLE-HYPHEN separator on the tabpanel id is load-bearing (design
    // review, HIGH, carried from the F2 panel layout — unchanged): a single
    // hyphen collides — slug() can mint a jar id ENDING in a panel token
    // (jar "Personal" + jar "Personal Cookies" → single-hyphen
    // "jar-personal-cookies" would be BOTH jar-Personal's cookies region and
    // jar-Personal-Cookies' own section id). slug() collapses non-alnum
    // runs to a single '-' and never emits '--', so 'jar-<id>--<panel>'
    // cannot collide. The tab BUTTON's id is the same string plus a '-tab'
    // suffix, distinct by construction.
    for (const panel of panels) {
      const tabId = 'jar-' + row.id + '--' + panel.id + '-tab';
      const panelId = 'jar-' + row.id + '--' + panel.id;
      const isDefaultTab = panel.id === 'history';

      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'jar-tab';
      tabBtn.id = tabId;
      tabBtn.setAttribute('role', 'tab');
      tabBtn.setAttribute('aria-selected', String(isDefaultTab));
      tabBtn.setAttribute('aria-controls', panelId);
      tabBtn.tabIndex = isDefaultTab ? 0 : -1;
      tabBtn.appendChild(document.createTextNode(panel.label));

      // History's count badge (DD6, repointed from the old disclosure-button
      // label) lives in its own <span> inside the tab button so label
      // patching stays targeted — see jars.js's fetchHistoryCount. Every
      // other tab's label is the static panel.label alone; jars.js's
      // render()/updateJarSection never touch this span (module doc
      // INVARIANT, jars.js).
      /** @type {HTMLElement|undefined} */
      let countSpan;
      if (panel.id === 'history') {
        countSpan = document.createElement('span');
        countSpan.className = 'jar-tab-count';
        tabBtn.appendChild(countSpan);
      }
      tabBtn.addEventListener('click', () => selectTab(getRefs(), panel.id));
      tablist.appendChild(tabBtn);

      const panelEl = document.createElement('div');
      panelEl.id = panelId;
      panelEl.setAttribute('role', 'tabpanel');
      panelEl.setAttribute('aria-labelledby', tabId);
      panelEl.className = 'jar-tabpanel';
      panelEl.hidden = !isDefaultTab;

      buildPanelContent(panel.id, panelEl);

      tabsWrap.appendChild(panelEl);
      tabRefs.set(panel.id, { tab: tabBtn, panel: panelEl, countSpan });
    }

    // Local roving-tabindex keydown handler. APG horizontal-tabs contract:
    // ArrowLeft/Right move+activate with wrap, Home/End jump to the ends.
    // Activation routes through the SAME shared selectTab() as click and
    // jars.js's hash deep-link.
    tablist.addEventListener('keydown', (e) => {
      const refs = getRefs();
      const order = panels.map((p) => p.id);
      const idx = order.indexOf(refs.activeTab);
      if (idx === -1) return;
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % order.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + order.length) % order.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = order.length - 1;
      if (nextIdx === null) return;
      e.preventDefault();
      const nextId = order[nextIdx];
      selectTab(refs, nextId);
      refs.tabRefs?.get(nextId)?.tab.focus();
    });

    return { tabsWrap, tabRefs };
  }

  return { build, selectTab };
}
