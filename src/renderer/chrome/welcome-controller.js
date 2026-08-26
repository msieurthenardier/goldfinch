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
    SEARCH_ENGINES, buildSearchUrl, currentSearchEngine, currentHomePage, // M16 F2 Leg 2
    normalizeHomePageInput // M16 F3 Leg 2, HAT item 5: bare-domain home-page input agrees with the address bar
  } = deps;
  // `els.address` is no longer read by this controller (M16 F3 Leg 2, HAT
  // item 6, DD7 pivot): settle()'s old defensive fallback — hide the panel
  // and focus the address bar — is gone along with the cross-window
  // auto-attach it guarded (see settle()'s doc comment below). `els` itself
  // stays destructured: `els.welcomeSurface` (root, above) still needs it.

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

  // Initial text only — render(tab, opts) below reassigns tagline.textContent
  // from the same block-visibility decisions it already makes (M16 F3 Leg 2,
  // HAT state D): a single-card record (search-only or home-only) otherwise
  // read "Set up the two things…" beside just one card.
  const tagline = document.createElement('p');
  tagline.className = 'welcome-tagline';
  tagline.textContent =
    "Set up the two things Goldfinch won't guess for you. You can always change these in Settings.";
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
  // reasons include 'search' (render(tab, opts) below) — stays shown once an
  // engine is chosen (M16 F3 Leg 2, HAT item 3).
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

  // Collected as they're built (M16 F3 Leg 2, HAT item 3) so render()'s radio
  // sync below never needs to re-query the DOM.
  /** @type {HTMLInputElement[]} */
  const engineRadios = [];

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
    engineRadios.push(radio);

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

  // render(tab, opts) (M16 F2 Leg 2 gate fix, split out of the old show();
  // opts added M16 F3 Leg 2, HAT item 3 design review; home block rewritten
  // M16 F3 Leg 2, HAT item 6, DD7 pivot): draws the panel for the record.
  // Safe to call unconditionally now — neither block's visibility depends on
  // whether its preference is still unset (see below), so there is no
  // "nothing left to draw" case left for a caller to avoid.
  //
  // Both blocks now share the SAME visibility rule: `tab.welcome.reasons.
  // has(x)`, i.e. why the tab was opened, never whether the preference is
  // currently unset. Per the operator's HAT rulings (item 3 for search, item
  // 6/DD7 for home), making a choice must not hide its block — it stays,
  // reflecting the saved value and a confirmation line, for the life of a
  // tab that was opened for that reason. `opts.search`/`opts.home`, when the
  // key is present, override the live cache reads (`currentSearchEngine()`/
  // `currentHomePage()`) — submitEngine/submitHome pass the value just
  // written, since the settings-changed broadcast that refreshes the cache
  // may not have landed yet; every other caller (show(), the
  // onSettingsChanged handler) passes no opts and gets the live cache.
  /** @param {any} tab @param {any} [opts] */
  function render(tab, opts = {}) {
    const showHome = !!(tab.welcome && tab.welcome.reasons.has('home'));
    homeBlock.classList.toggle('hidden', !showHome);
    burnerNote.classList.toggle('hidden', !(tab.container && tab.container.burner));
    const home = 'home' in opts ? opts.home : currentHomePage();
    if (showHome) {
      // Reflect the resolved value into the field, but never while the
      // operator is actively typing in it (M16 F3 Leg 2, HAT item 6 design
      // review [medium]) — an external write (another window's Settings,
      // this tab's own just-completed submit) must not clobber in-progress
      // input.
      if (document.activeElement !== homeInput) homeInput.value = home != null ? home : '';
      homeStatus.textContent = home != null ? 'Saved — new tabs will open here.' : '';
    } else {
      homeInput.value = '';
      homeStatus.textContent = '';
    }
    const query = tab.welcome && tab.welcome.pendingQuery;
    // textContent only — a pending query is user/page text, never markup.
    engineHeading.textContent = query ? `Where should we search for "${query}"?` : 'Search engine';
    const showEngine = !!(tab.welcome && tab.welcome.reasons.has('search'));
    engineBlock.classList.toggle('hidden', !showEngine);
    // Tagline copy (M16 F3 Leg 2, HAT state D): driven off the same showHome/
    // showEngine booleans above — no recomputation, no engine-name literal
    // (the no-duplication structural test). The "neither" case is not
    // expected to render — every welcome record's reasons always include at
    // least 'home' (tab-controller.js's welcomeReasons always seeds it), so
    // one of the two branches above always matches in practice; it falls
    // back to the "two things" copy rather than an empty string.
    if (showHome && showEngine) {
      tagline.textContent =
        "Set up the two things Goldfinch won't guess for you. You can always change these in Settings.";
    } else if (showHome) {
      tagline.textContent = 'Choose where new tabs open. You can always change this in Settings.';
    } else if (showEngine) {
      tagline.textContent = 'Choose where your searches go. You can always change this in Settings.';
    } else {
      tagline.textContent =
        "Set up the two things Goldfinch won't guess for you. You can always change these in Settings.";
    }
    if (showEngine) {
      const engine = 'search' in opts ? opts.search : currentSearchEngine();
      // Sync the radios to the resolved engine — reflects this tab's own
      // just-made choice, or one made/cleared elsewhere (Settings, another
      // window) while this tab's engine block is showing. Assign `.checked`
      // directly; never `.click()` a radio programmatically (that would
      // re-fire `change` and re-submit).
      for (const radio of engineRadios) radio.checked = (radio.value === engine);
      // Confirmation text is state-derived, not an event-driven one-shot: it
      // reflects whatever the resolved engine currently is, so a tab switch
      // or an unrelated broadcast never leaves a stale or missing message.
      engineStatus.textContent = engine != null
        ? 'Saved — you can always change this in Settings.'
        : '';
    } else {
      engineStatus.textContent = '';
    }
    root.classList.remove('hidden');
  }

  // show(tab) (M16 F2 Leg 1/2, DD1/DD7 — fix at the Leg 2 acceptance gate):
  // called on every activation-class event for a viewless welcome record
  // (tab-controller.js's activateTab/onViewCreated) AND for an in-place
  // re-render of the ALREADY-shown record (navigation-controller.js's search
  // handoff). Delegates to settle() rather than rendering directly, so a
  // background welcome record catches up on any preference filled in
  // elsewhere (another tab's Settings page) the moment it becomes visible
  // again, rather than only on the next unrelated broadcast.
  //
  // M16 F3 Leg 2, HAT item 6 (DD7 pivot): the welcome surface itself never
  // navigates on its own except to run a pending search once an engine is
  // chosen — Flight 2 DD7's cross-window auto-attach (a shown welcome record
  // attaching to the home page the instant it became fully set) is retired.
  // A welcome tab shown here — including one picked back up in ANOTHER
  // window after this window made the preference change — now re-renders
  // with the saved value and a confirmation line instead of auto-navigating.
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
    // M16 F3 Leg 2, HAT item 5: normalize a bare domain (e.g. `example.com`)
    // to `https://example.com` before the write, the same rule the address
    // bar already applies via toUrl — the store validator (isSafeTabUrl)
    // requires a scheme and stays the actual gate.
    const value = normalizeHomePageInput(homeInput.value);
    const result = await welcomeSetPreference({ key: 'homePage', value });
    if (result && result.ok) {
      // M16 F3 Leg 2, HAT item 6 (DD7 pivot): save and stay — the welcome
      // surface no longer navigates itself away on a successful Set; the
      // saved home page applies starting with the next new tab
      // (tab-controller.js's openNewTab). settle()'s override resolves the
      // just-written value immediately (the settings-changed broadcast that
      // refreshes the currentHomePage() cache may not have landed yet),
      // which render() reflects into the field and its status line.
      settle(tab, { home: value });
    } else {
      homeStatus.textContent = 'Enter a valid address.';
    }
  }
  homeSet.addEventListener('click', () => { submitHome(); });

  // settle(tab, opts) (M16 F2 Leg 2, DD3/DD7; opts added M16 F3 Leg 2, HAT
  // item 3 design review; rewritten HAT item 6, DD7 pivot): the single place
  // that decides what happens to a welcome record — called after any
  // preference change (a successful home-page or engine submit, the
  // settings-changed broadcast, or show() picking the record back up). The
  // welcome surface never navigates itself away any more EXCEPT to run a
  // pending search once an engine is known: if a query is waiting and an
  // engine is resolved, attach to the search URL; otherwise re-render —
  // render(tab, opts) always has something correct to draw (each block
  // reflects its own saved-or-not state, per its own doc comment above), so
  // there is no separate "nothing left unset" branch left to detect. Setting
  // the home page alone, or with no pending query, therefore leaves the tab
  // showing the saved value rather than attaching to it — the home page
  // applies starting with the NEXT new tab (tab-controller.js's
  // openNewTab), not this one. `opts.search`, when present, overrides the
  // live engine cache for the attach check and URL — see render()'s doc
  // comment above.
  /** @param {any} tab @param {any} [opts] */
  function settle(tab, opts = {}) {
    const engine = 'search' in opts ? opts.search : currentSearchEngine();
    const query = tab.welcome && tab.welcome.pendingQuery;
    if (query != null && engine != null) {
      attachView(tab, buildSearchUrl(engine, query));
      return;
    }
    render(tab, opts);
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
    // never from the cache, via the settle() override below. `reasons` is
    // deliberately left untouched (M16 F3 Leg 2, HAT item 3 design review):
    // the engine block's visibility is keyed off `reasons.has('search')`
    // (why the tab was opened), not the live unset state, so it stays shown
    // with the selection and a confirmation line rather than disappearing.
    const pendingQuery = tab.welcome.pendingQuery;
    if (pendingQuery != null) {
      attachView(tab, buildSearchUrl(id, pendingQuery));
      return;
    }
    // A `search`-only record is always created with a `pendingQuery` today
    // (navigation-controller.js's handoffSearch, the context-menu handoff) —
    // "engine-only, no query" is unreachable, so no defensive branch is
    // built for it here; the branch above always returns first in practice.
    settle(tab, { search: id });
  }

  // Edge Case (leg 1 spec, generalized this leg; re-scoped M16 F3 Leg 2, HAT
  // item 6, DD7 pivot): setting a preference from elsewhere (another
  // window's Settings page, or this tab's own submit above going through the
  // SAME broadcast) re-renders the currently-shown record immediately, so a
  // block's saved-value/confirmation reflects the change without waiting for
  // the operator to switch away and back. It no longer attaches anything —
  // the only auto-navigation left anywhere in this controller is settle()'s
  // pending-search branch, and a settings-changed broadcast never carries a
  // query.
  //
  // Deliberately scoped to `currentTab` only (M16 F2 Leg 2 gate fix): this
  // broadcast fires for EVERY settings change while ANY number of background
  // welcome records may exist, off-screen, elsewhere in the tab strip.
  // Settling every one of them here would re-render off-screen state nobody
  // is looking at for no benefit. show() (above) is what catches a
  // background record up: it settles it the instant it becomes the active
  // tab, on demand rather than eagerly.
  onSettingsChanged((all) => {
    const tab = currentTab;
    if (!tab || !tab.welcome || all == null) return;
    if (all.homePage === undefined && all.searchEngine === undefined) return;
    settle(tab);
  });

  return { show, hide };
}
