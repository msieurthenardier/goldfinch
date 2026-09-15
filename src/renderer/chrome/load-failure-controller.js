// The load-failure surface's own controller (Mission 20 Flight 1 Leg 2, DD1).
// Chrome DOM nested inside #webviews (index.html), shown while the active
// tab's own navigation has failed (tab-controller.js's activateTab calls
// show()/hide() on every activation-class event, mirroring
// welcome-controller.js's show()/hide() pair) and hidden otherwise. Built
// once with createElement/textContent — no innerHTML from data. The
// controller self-subscribes to bridge.onTabLoadFailure (DD1/AC2) — it is the
// one place that reacts to the main-pushed failure/clear transition.

import { failedTabTitle } from '../../shared/load-failure.js';

/** @param {any} deps */
export function createLoadFailureController(deps) {
  const { document, els, bridge, findTabByWcId, isActiveTab, classifyLoadFailure, updateAddressChip } = deps;

  const root = els.loadFailureSurface;
  root.textContent = '';

  const column = document.createElement('div');
  column.className = 'load-failure-column';
  root.appendChild(column);

  // tabindex="-1" (AC1/DD6): a programmatic focus target, never in the Tab
  // order on its own — F6 and the failure-lands-while-active case both move
  // focus here explicitly.
  const heading = document.createElement('h2');
  heading.id = 'load-failure-heading';
  heading.tabIndex = -1;
  column.appendChild(heading);

  const body = document.createElement('p');
  body.id = 'load-failure-body';
  column.appendChild(body);

  const urlLine = document.createElement('p');
  urlLine.id = 'load-failure-url';
  column.appendChild(urlLine);

  const codeLine = document.createElement('p');
  codeLine.id = 'load-failure-code';
  column.appendChild(codeLine);

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.id = 'load-failure-retry';
  retry.textContent = 'Retry';
  column.appendChild(retry);

  /** @type {any} */
  let currentTab = null;

  // render(tab): reads classifyLoadFailure(tab.loadFailure) and writes every
  // line via textContent only — engine strings (the raw `name`) and the
  // intended address are user/page-adjacent data, never markup (house rule).
  /** @param {any} tab */
  function render(tab) {
    const failure = tab && tab.loadFailure;
    const classification = classifyLoadFailure(failure);
    heading.textContent = classification.title;
    body.textContent = classification.body;
    urlLine.textContent = (failure && failure.url) || (tab && tab.url) || '';
    codeLine.textContent = (failure && failure.name) || '';
    retry.classList.toggle('hidden', !classification.retryable);
  }

  /** @param {any} tab */
  function show(tab) {
    currentTab = tab;
    render(tab);
    root.classList.remove('hidden');
  }

  function hide() {
    currentTab = null;
    root.classList.add('hidden');
  }

  // focusHeading(): the F6 target (DD6) and the failure-lands-on-active-tab
  // orphan-focus guard (AC2) both call this — Retry is never auto-focused.
  function focusHeading() {
    heading.focus();
  }

  // applyStripState(tab) is the ONLY writer of `data-load-state` / the
  // `.tab-status` span (Implementation Guidance #3) — called for every
  // failure/clear push regardless of whether the tab is active, so the strip
  // never lags a background failure (behavior spec steps 4-5).
  /** @param {any} tab */
  function applyStripState(tab) {
    if (!tab || !tab.btn) return;
    const statusEl = tab.btn.querySelector('.tab-status');
    const titleEl = tab.btn.querySelector('.tab-title');
    const closeEl = tab.btn.querySelector('.tab-close');
    if (tab.loadFailure) {
      tab.btn.dataset.loadState = 'failed';
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = '⚠';
      }
      const host = failedTabTitle(tab);
      if (titleEl) titleEl.textContent = host;
      tab.btn.title = host;
      const label = `${host} — failed to load`;
      tab.btn.setAttribute('aria-label', label);
      if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${label}`);
    } else {
      delete tab.btn.dataset.loadState;
      if (statusEl) {
        statusEl.hidden = true;
        statusEl.textContent = '';
      }
      // Re-derive exactly as renderer.js's onTabTitle does on an ordinary push.
      const name = tab.title || tab.url;
      if (titleEl) titleEl.textContent = name;
      tab.btn.title = name || '';
      tab.btn.setAttribute('aria-label', name);
      if (closeEl) closeEl.setAttribute('aria-label', `Close tab: ${name}`);
    }
  }

  // Retry (AC6): navigates the tab the panel currently shows via the
  // recorded intended address — never the address bar's navigate()/toUrl,
  // which would re-run search-vs-URL resolution over an address that already
  // parsed as a URL once. main clears the failure on did-start-navigation and
  // the resulting null push hides this panel (AC2).
  retry.addEventListener('click', () => {
    const tab = currentTab;
    if (!tab || !tab.loadFailure || tab.wcId == null) return;
    bridge.tabNavigate({ wcId: tab.wcId, verb: 'loadURL', args: [tab.loadFailure.url || tab.url] });
  });

  // The controller subscribes to the owner-routed push itself (DD1) — no
  // other file reacts to tab-load-failure.
  bridge.onTabLoadFailure(({ wcId, failure }) => {
    const tab = findTabByWcId(wcId);
    if (!tab) return; // unknown wcId (e.g. onViewCreated pending) — no-op
    // DD4/DD6/DD7: `did-navigate` never fires for the error commit (leg-1
    // spike finding (b)), so a re-navigate on an EXISTING tab would otherwise
    // leave `tab.url` stale at whatever it was before — wrong for the address
    // bar on the next activation and for the census. The push's own
    // `failure.url` (main's `lastRequestedUrl`) is the intended address.
    if (failure && failure.url) tab.url = failure.url;
    tab.loadFailure = failure || null;
    applyStripState(tab);
    if (!isActiveTab(tab)) return;
    if (failure) {
      show(tab);
      // F1 (post-acceptance fix pass): a programmatic re-navigation of an
      // already-open ACTIVE tab never fires did-navigate on failure (DD4/DD6),
      // so the address bar/chip would otherwise keep whatever was previously
      // committed — mirror activateTab's own sync. Skipped while the operator
      // is typing in the address bar (never clobber in-progress input).
      if (document.activeElement !== els.address) {
        els.address.value = tab.url;
        updateAddressChip(tab);
      }
      // Focus the panel only when no chrome control already holds focus (the
      // typed-Enter pendingFocusGuest case, which never resolves for a
      // failed load) — never steal focus from an operator mid-interaction.
      if (document.activeElement === null || document.activeElement === document.body) {
        focusHeading();
      }
    } else {
      hide();
    }
  });

  return { show, hide, focusHeading, applyStripState };
}
