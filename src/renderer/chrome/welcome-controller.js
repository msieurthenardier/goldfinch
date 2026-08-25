// The welcome surface's own controller (M16 F2 Leg 1/2, DD1/DD7). Chrome DOM
// nested inside #webviews (index.html), shown while the active tab is a
// viewless welcome record (tab-controller.js's activateTab/onViewCreated
// call show()/hide() on every activation-class event) and hidden otherwise.
// Built once with createElement/textContent — no innerHTML from data. The
// engine block (M16 F2 Leg 2, DD7) renders the eight-engine radio list from
// the injected SEARCH_ENGINES table (factory-deps pattern, the
// navigation-controller.js precedent — no engine data is hand-typed here).

/** @param {any} deps */
export function createWelcomeController(deps) {
  const {
    document, els, attachView, welcomeSetPreference, onSettingsChanged,
    SEARCH_ENGINES, buildSearchUrl, currentSearchEngine, currentHomePage // M16 F2 Leg 2
  } = deps;
  // `els.address` (M16 F2 Leg 2 gate fix): focus target for settle()'s
  // defensive fallback below — already part of the shared `els` object every
  // other chrome controller receives, no new dep wiring needed.

  const root = els.welcomeSurface;
  root.textContent = '';

  // Layout column (M16 F3 Leg 1, DD1/DD6): a centered column wrapping the
  // brand header, the notice, and the two cards — additive wrapper DOM only,
  // no id/class the specs or structural tests read is touched below.
  const column = document.createElement('div');
  column.className = 'welcome-column';
  root.appendChild(column);

  // Brand header (M16 F3 Leg 1, DD1): mark + the existing #welcome-heading +
  // a new tagline. The heading keeps its id — #welcome-surface's
  // aria-labelledby target — it is only moved, never renamed.
  const brandHeader = document.createElement('header');
  brandHeader.className = 'welcome-brand';
  column.appendChild(brandHeader);

  const mark = /** @type {HTMLImageElement} */ (document.createElement('img'));
  mark.className = 'welcome-mark';
  mark.src = 'assets/goldfinch_color.png';
  mark.alt = '';
  brandHeader.appendChild(mark);

  const heading = document.createElement('h2');
  heading.id = 'welcome-heading';
  heading.textContent = 'Welcome to Goldfinch';
  brandHeader.appendChild(heading);

  const tagline = document.createElement('p');
  tagline.className = 'welcome-tagline';
  tagline.textContent = "Set up the two things Goldfinch won't guess for you.";
  brandHeader.appendChild(tagline);

  // Burner note (DD7, restyled M16 F3 Leg 1 DD4): "This choice is saved for
  // all of Goldfinch." Moved directly under the brand header so it is read
  // before either choice; id, text, and the `hidden` toggle target
  // (`burnerNote`, below) are unchanged — only its class and DOM position move.
  const burnerNote = document.createElement('p');
  burnerNote.id = 'welcome-burner-note';
  burnerNote.className = 'welcome-notice hidden';
  burnerNote.textContent = 'This choice is saved for all of Goldfinch.';
  column.appendChild(burnerNote);

  // Home-page block (DD7): text input + Set + the "just type an address"
  // hint. Hidden entirely unless the record's reasons include 'home'.
  const homeBlock = document.createElement('div');
  homeBlock.id = 'welcome-home-block';
  homeBlock.classList.add('welcome-card');

  const homeLabel = document.createElement('label');
  homeLabel.htmlFor = 'welcome-home-input';
  homeLabel.textContent = 'Home page';
  homeBlock.appendChild(homeLabel);

  const homeInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  homeInput.type = 'url';
  homeInput.id = 'welcome-home-input';
  homeInput.autocomplete = 'off';
  homeInput.spellcheck = false;
  homeBlock.appendChild(homeInput);

  const homeSet = document.createElement('button');
  homeSet.type = 'button';
  homeSet.id = 'welcome-home-set';
  homeSet.textContent = 'Set';
  homeBlock.appendChild(homeSet);

  const homeHint = document.createElement('p');
  homeHint.className = 'muted';
  homeHint.textContent = 'Or just type an address above.';
  homeBlock.appendChild(homeHint);

  const homeStatus = document.createElement('p');
  homeStatus.id = 'welcome-home-status';
  homeStatus.setAttribute('role', 'status');
  homeBlock.appendChild(homeStatus);

  column.appendChild(homeBlock);

  // Engine block (M16 F2 Leg 2, DD7): heading + the eight-engine radio list,
  // built ONCE from SEARCH_ENGINES (never rebuilt on show/broadcast — the
  // settings.js engine IIFE's "build once, drive via accessor functions"
  // discipline, DD7 Implementation Guidance #3). Hidden unless the record's
  // reasons include 'search' AND no engine is set yet (unsetReasons below).
  const engineBlock = document.createElement('div');
  engineBlock.id = 'welcome-engine-block';
  engineBlock.classList.add('welcome-card');

  const engineHeading = document.createElement('h3');
  engineHeading.id = 'welcome-engine-heading';
  engineBlock.appendChild(engineHeading);

  const engineOptions = document.createElement('div');
  engineOptions.id = 'welcome-engine-options';
  engineOptions.className = 'welcome-engine-grid';
  engineOptions.setAttribute('role', 'radiogroup');
  engineOptions.setAttribute('aria-labelledby', 'welcome-engine-heading');
  engineBlock.appendChild(engineOptions);

  const engineStatus = document.createElement('p');
  engineStatus.id = 'welcome-engine-status';
  engineStatus.setAttribute('role', 'status');
  engineBlock.appendChild(engineStatus);

  column.appendChild(engineBlock);

  for (const engine of SEARCH_ENGINES) {
    const row = document.createElement('div');
    row.className = 'welcome-engine-row';

    const radio = /** @type {HTMLInputElement} */ (document.createElement('input'));
    radio.type = 'radio';
    // A distinct radio `name` from every chrome radio (Implementation Guidance
    // #3) — this is the ONLY radio group hosted in the chrome document today,
    // but the name is still namespaced to avoid ever colliding with a future one.
    radio.name = 'welcome-search-engine';
    radio.id = 'welcome-engine-' + engine.id;
    radio.value = engine.id;

    const label = document.createElement('label');
    label.htmlFor = radio.id;
    const labelText = document.createElement('span');
    labelText.textContent = engine.label;
    label.appendChild(labelText);

    row.appendChild(radio);
    row.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'muted';
    desc.textContent = engine.description;
    row.appendChild(desc);

    engineOptions.appendChild(row);

    // Native `change` fires only on a real selection change (no same-value
    // guard needed — settings.js's engine IIFE precedent).
    radio.addEventListener('change', () => {
      if (radio.checked) submitEngine(engine.id);
    });
  }

  /** @type {any} */
  let currentTab = null;

  // unsetReasons(tab) (M16 F2 Leg 2): which of the record's reasons STILL
  // correspond to an unset preference, right now — reasons.has(x) alone is
  // not enough, since the preference can be set by ANY path (this tab's own
  // submit, another window's Settings page, this same broadcast) while the
  // record is showing.
  /** @param {any} tab @returns {Set<string>} */
  function unsetReasons(tab) {
    const reasons = (tab.welcome && tab.welcome.reasons) || new Set();
    const unset = new Set();
    if (reasons.has('home') && currentHomePage() == null) unset.add('home');
    if (reasons.has('search') && currentSearchEngine() == null) unset.add('search');
    return unset;
  }

  // render(tab) (M16 F2 Leg 2 gate fix, split out of the old show()): draws
  // the panel for a record that still has at least one unset reason. Never
  // called directly for a record with nothing left unset — settle() is the
  // only caller that decides that, so a fully-settled record is never drawn
  // with both blocks hidden and no attach happening.
  /** @param {any} tab */
  function render(tab) {
    const unset = unsetReasons(tab);
    homeBlock.classList.toggle('hidden', !unset.has('home'));
    burnerNote.classList.toggle('hidden', !(tab.container && tab.container.burner));
    homeInput.value = '';
    homeStatus.textContent = '';
    const query = tab.welcome && tab.welcome.pendingQuery;
    // textContent only — a pending query is user/page text, never markup.
    engineHeading.textContent = query ? `Where should we search for "${query}"?` : 'Search engine';
    engineBlock.classList.toggle('hidden', !unset.has('search'));
    engineStatus.textContent = '';
    root.classList.remove('hidden');
  }

  // show(tab) (M16 F2 Leg 1/2, DD1/DD7 — fix at the Leg 2 acceptance gate):
  // called on every activation-class event for a viewless welcome record
  // (tab-controller.js's activateTab/onViewCreated) AND for an in-place
  // re-render of the ALREADY-shown record (navigation-controller.js's search
  // handoff). Delegates to settle() rather than rendering directly: a
  // background welcome record can have had its LAST unset preference filled
  // in from elsewhere (another tab's Settings page) while it was not the
  // active tab — onSettingsChanged only settles the CURRENTLY SHOWN record
  // (see that handler below), so show() is the other place that must catch
  // up, on whatever record is about to become visible. Without this, a
  // record whose reasons are now all set renders an empty panel (both blocks
  // hidden) instead of attaching, because nothing else ever re-checks it.
  /** @param {any} tab */
  function show(tab) {
    currentTab = tab;
    settle(tab);
  }

  function hide() {
    currentTab = null;
    root.classList.add('hidden');
  }

  async function submitHome() {
    const tab = currentTab;
    if (!tab) return;
    const value = homeInput.value.trim();
    const result = await welcomeSetPreference({ key: 'homePage', value });
    if (result && result.ok) {
      homeStatus.textContent = '';
      attachView(tab, value);
    } else {
      homeStatus.textContent = 'Enter a valid address.';
    }
  }
  homeSet.addEventListener('click', () => { submitHome(); });

  // settle(tab) (M16 F2 Leg 2, DD3/DD7): the single place that decides what
  // happens to a welcome record given its CURRENT unset reasons — called
  // after any preference change that might leave it with nothing left to
  // ask (a successful engine choice with no pending query, the
  // settings-changed broadcast, or show() picking the record back up). If a
  // reason is still unset, render the panel (a block may have just
  // disappeared). Otherwise attach: a pending query runs now that an engine
  // exists; else the home page attaches if it is now set; otherwise (DD7's
  // fallback wording) leave it an empty new tab with the address bar
  // focused.
  /** @param {any} tab */
  function settle(tab) {
    if (unsetReasons(tab).size > 0) { render(tab); return; }
    const pendingQuery = tab.welcome && tab.welcome.pendingQuery;
    if (pendingQuery != null) {
      attachView(tab, buildSearchUrl(currentSearchEngine(), pendingQuery));
      return;
    }
    const home = currentHomePage();
    if (home != null) { attachView(tab, home); return; }
    // Defensive, not expected to be reachable in practice: every welcome
    // record's reasons always include 'home' (tab-controller.js's
    // welcomeReasons always seeds it), so unsetReasons(tab).size === 0
    // already implies currentHomePage() is set and the branch above already
    // returned. Kept for DD7's stated fallback in case a future reason set
    // ever omits 'home'. Must NOT call show()/render() here — this record
    // has nothing left to ask, so redrawing an all-blocks-hidden panel would
    // just repeat the bug this fix closes. Hide the panel and hand focus to
    // the address bar instead, per DD7.
    hide();
    els.address.focus();
  }

  async function submitEngine(id) {
    const tab = currentTab;
    if (!tab || !tab.welcome) return;
    const result = await welcomeSetPreference({ key: 'searchEngine', value: id });
    if (!result || !result.ok) {
      // Implementation Guidance #3: show the error inline, keep the radios —
      // the operator can retry without losing their place.
      engineStatus.textContent = 'Could not save — try again.';
      return;
    }
    engineStatus.textContent = '';
    // The write succeeded, but the settings-changed broadcast that refreshes
    // currentSearchEngine()'s cache may not have landed by the time this
    // continuation runs (an IPC round-trip, not synchronous with the invoke
    // reply) — resolve THIS tab's outcome from `id`, the value just written,
    // never from the cache. Removing 'search' from the record's own reasons
    // (rather than relying on unsetReasons' cache read) is what makes
    // settle() below correct even if the broadcast is still in flight.
    const pendingQuery = tab.welcome.pendingQuery;
    if (pendingQuery != null) {
      attachView(tab, buildSearchUrl(id, pendingQuery));
      return;
    }
    tab.welcome.reasons.delete('search');
    settle(tab);
  }

  // Edge Case (leg 1 spec, generalized this leg): setting a preference from
  // elsewhere (another window's Settings page, or this tab's own submit
  // above going through the SAME broadcast) re-renders immediately, and
  // attaches once nothing is left unset — the block would otherwise sit
  // there advertising a preference that is no longer missing.
  //
  // Deliberately scoped to `currentTab` only (M16 F2 Leg 2 gate fix): this
  // broadcast fires for EVERY settings change while ANY number of background
  // welcome records may exist, off-screen, elsewhere in the tab strip.
  // Settling every one of them here — walking all tabs and attaching each
  // whose reasons just cleared — would fire multiple tabCreate/navigate
  // calls the operator never asked for, off-screen, the moment they finish
  // Settings. DD7 only promises the settle happens "until it navigates or
  // until nothing is missing" for a record that's being looked at; it says
  // nothing about eagerly converting every dormant welcome tab in the
  // background. show() (above) is what actually closes the gate finding: it
  // now settles a background record the instant it becomes the active tab,
  // which is the smaller, DD7-consistent fix — no background record is ever
  // left permanently stuck, it just settles on demand rather than eagerly.
  onSettingsChanged((all) => {
    const tab = currentTab;
    if (!tab || !tab.welcome || all == null) return;
    if (all.homePage === undefined && all.searchEngine === undefined) return;
    settle(tab);
  });

  return { show, hide };
}
