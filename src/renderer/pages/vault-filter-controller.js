// @ts-check
// goldfinch://vault serves imports through an exact flat allowlist. This module carries
// no static import of its own — see the header comment below for why — so it needs only
// its own route in internal-page-map.js.

/**
 * vault-filter-controller.js — the page-wide vault filter (Mission 22, Flight 1).
 *
 * Owns the filter field, the clear button, the status line, a row registry, and the
 * hide-don't-re-render reconciliation (flight DD1): a vault registers its `{ row, meta }`
 * pairs once its item lists finish rendering, and the controller hides non-matching rows
 * plus any type subsection or vault section left with no visible match. An unloaded vault
 * is never hidden — its rows don't exist yet, and "no rows" does not mean "no matches".
 *
 * **Hide mechanism (leg-level refinement of DD1): a class, not the `hidden` attribute.**
 * The controller toggles `vault-filter-out` (`vault.css`: `display: none !important`)
 * rather than writing `hidden`, for two reasons: (1) `renderUnknownItems` already owns
 * `hidden` on the "Other items" subsection (hidden while empty) — a filter that wrote
 * `hidden` would clobber that base state the moment the query cleared; (2) `!important`
 * beats every author `display` rule (including `.vault-item-row { display: flex }`), so no
 * per-selector `[hidden]` overrides are needed. `display: none` also removes the element
 * from the accessibility tree, which is what DD1 wanted from `hidden` in the first place.
 *
 * **Registry shape.** `registry` maps a registered row element to its metadata.
 * `sectionRows` maps a registered (loaded) vault SECTION element to the exact array of row
 * elements `registerVault` was called with for that section — computed once at
 * registration, not re-derived by DOM search at every `apply()`. A row's owning TYPE
 * SUBSECTION (`.vault-type-subsection`, including the defensive "Other items" one) is
 * discovered per-section at apply time via `section.children` (a plain array walk, no CSS
 * selector engine — the vault page's five item subsections are always direct children of
 * the vault section, ahead of the jar-only Access-keys subsection) plus `.contains(row)`
 * for row membership — this is the "closest()/contains()" idiom the leg calls for, chosen
 * as a `children` walk rather than `querySelectorAll` so the SAME code runs unmodified
 * against the lightweight mock DOM the unit tests use (no `querySelectorAll` needed there).
 * This also naturally covers a subsection with ZERO items (its own "No … yet" empty state,
 * never itself a registered row): with a query active it still collapses, because it has
 * "no visible registered row" trivially.
 *
 * **The Access-keys subsection is never registered.** `buildAccessKeysSection` builds an
 * independent `section.vault-accesskeys` (not `.vault-type-subsection`), fetched over its
 * own async chain outside `registerVault`'s pairs — so it is never a match target and is
 * never individually toggled. It disappears only as a side effect of its OWNING vault
 * section collapsing (an FD ruling, flight log 2026-09-22: "a jar vault with zero item
 * matches hides whole, including its Access-keys subsection" — CSS `display: none` on an
 * ancestor collapses every descendant regardless of the descendant's own class).
 *
 * **Stale registrations are dropped.** `registerVault` ignores a section that is not
 * `isConnected` — the guard is sufficient with no generation token, because `render()`
 * always builds fresh section elements on every rebuild (there is no path that re-renders
 * a single vault's item lists without a full page `render()`), so a `.then` continuation
 * from a superseded render can only ever resolve against a section that has since been
 * detached from the live document.
 *
 * **Live region (AC10).** `#vault-root` carries `aria-live="polite"`, so toggling many
 * rows' visibility on every keystroke risks a screen reader reading large amounts of
 * content per edit. `registerVault` sets `aria-live="off"` directly on the vault section
 * it just took ownership of (a nearer `aria-live` beats an ancestor's for the section
 * itself and every descendant with no closer one of its own) — muting every SUBSEQUENT
 * filter-driven toggle on that section's rows/subsections/itself, while leaving the
 * section's OWN initial content-population announcement alone (the rows are already
 * populated by the time `registerVault` runs) and leaving every non-filter-managed
 * `#vault-root` child (Settings, the "Vaults" group header, a locked vault section — never
 * registered) untouched. **`aria-live="off"` on the section is scoped back down, structurally,
 * to just the filter-managed subtree**: `registerVault` re-declares `aria-live="polite"` on
 * every DIRECT child of the section that is NOT a `.vault-type-subsection` (the title-row
 * header, and — for a jar vault — the `.vault-accesskeys` subsection) — a class-based rule,
 * not a `.vault-accesskeys`-only special case, so a future non-filter-managed child added to
 * `buildVaultSection` inherits the correct scoping automatically. This matters because
 * Access-keys renders content (its mint/revoke list) AFTER registration, on its own async
 * chain outside the filter entirely (see below) — without this re-declaration, the section's
 * `aria-live="off"` would silence those updates too, which is a regression `registerVault`
 * must not cause. `#vault-filter-status`'s own `role="status"` stays a live region regardless
 * of ancestry. See `registerVault`'s own comment for the detail.
 *
 * No bridge/IPC access — every dependency is injected. `itemMatchesFilter`/`filterStatusText`
 * (the pure matcher + status-copy, `vault-page-model.js`) are injected rather than statically
 * imported here — a DELIBERATE shape choice, the `jars-section-controller.js`/`jars.js` split
 * (a page-level controller receiving shared pure functions as deps from its page, which does
 * the real import) rather than the `vault-restore-controller.js`/`vault-browser-import-
 * controller.js` shape (a direct `./vault-page-model.js` flat-specifier import). The direct-
 * import shape only resolves through the internal-page-map's custom serving-path resolver at
 * runtime — Node's plain ESM resolution has no route from `src/renderer/pages/` to
 * `src/shared/`, so a module written that way cannot be `import()`ed directly in a Node unit
 * test (its sibling tests are source-scan-only, never live execution). Injecting the matcher
 * keeps this controller fully executable against a mock DOM via a direct dynamic import — the
 * `vault-nav-controller.js`/`vault-nav-controller.test.js` precedent — which is what the rich
 * reconciliation-logic tests below need. `vault.js` imports the real functions from
 * `./vault-page-model.js` (already importing other exports from it) and passes them here.
 *
 * @param {{
 *   document: Document,
 *   navEl: HTMLElement,
 *   itemMatchesFilter: (meta: any, query: string) => boolean,
 *   filterStatusText: (count: number, active: boolean) => string
 * }} deps
 */
export function createVaultFilter(deps) {
  const { document, navEl, itemMatchesFilter, filterStatusText } = deps;

  // The DD1-refinement hide class (CSS: `.vault-filter-out { display: none !important; }`).
  const HIDE_CLASS = 'vault-filter-out';
  // The DOM class the controller walks to find a vault section's per-type subsections
  // (login/card/note/identity + the defensive "Other items" one) — never the jar-only
  // Access-keys subsection, which carries a different class and is deliberately excluded.
  const SUBSECTION_CLASS = 'vault-type-subsection';

  /** The current query, always the trimmed-or-not raw field value (trimming happens inside
   * `itemMatchesFilter`, so an in-progress trailing space still narrows live). */
  let query = '';

  /** @type {Map<Element, any>} row element → its metadata. */
  const registry = new Map();
  /** @type {Map<Element, Element[]>} loaded vault SECTION element → its registered rows. */
  const sectionRows = new Map();

  /** @type {HTMLInputElement|null} */
  let inputEl = null;
  /** @type {HTMLButtonElement|null} */
  let clearBtnEl = null;
  /** @type {HTMLElement|null} */
  let statusEl = null;

  /**
   * Is `el` visible per the filter's OWN hide class? (Ancestor collapse via `!important`
   * means a row can read as "not displayed" even while its own class says visible — this
   * predicate answers only "did the filter itself mark this element out", the input every
   * reconciliation step below needs.)
   * @param {Element} el
   */
  function ownVisible(el) {
    return !el.classList.contains(HIDE_CLASS);
  }

  /**
   * Walk up from `node` (inclusive) toward `navEl`, returning the first ancestor `<a>`
   * whose `href` attribute starts with `#vault-`, or `null`. Bounded at `navEl` so an
   * unrelated ancestor anchor outside the nav can never match (DD6/AC9).
   * @param {any} node
   * @returns {any}
   */
  function closestVaultAnchor(node) {
    let n = node;
    while (n && n !== navEl) {
      if (n.tagName === 'A') {
        const href = typeof n.getAttribute === 'function' ? n.getAttribute('href') : null;
        return typeof href === 'string' && href.indexOf('#vault-') === 0 ? n : null;
      }
      n = n.parentNode;
    }
    return null;
  }

  /**
   * The currently-loaded section whose id equals `id`, or `null`. `sectionRows`' keys are
   * exactly the loaded (registered) vault sections.
   * @param {string} id
   */
  function findLoadedSectionById(id) {
    for (const section of sectionRows.keys()) {
      if (/** @type {any} */ (section).id === id) return section;
    }
    return null;
  }

  /**
   * The single reconciliation point (DD1): re-evaluates every registered row against the
   * live query, then each loaded section's type subsections, then each loaded section
   * itself, then the status line and the clear button's visibility. Called on every input
   * event and on every `registerVault` (a late-arriving vault picks up the live query the
   * moment it registers).
   */
  function apply() {
    const active = query.trim().length > 0;

    // 1. Rows.
    let visibleCount = 0;
    for (const [row, meta] of registry) {
      const visible = !active || itemMatchesFilter(meta, query);
      /** @type {any} */ (row).classList.toggle(HIDE_CLASS, !visible);
      if (visible) visibleCount += 1;
    }

    // 2/3. Subsections, then sections — one loaded section at a time.
    for (const [section, rows] of sectionRows) {
      const children = /** @type {any} */ (section).children || [];
      for (const child of children) {
        if (!child.classList || !child.classList.contains(SUBSECTION_CLASS)) continue;
        const hasVisible = rows.some((row) => child.contains(row) && ownVisible(row));
        child.classList.toggle(HIDE_CLASS, active && !hasVisible);
      }
      const sectionHasVisible = rows.some(ownVisible);
      /** @type {any} */ (section).classList.toggle(HIDE_CLASS, active && !sectionHasVisible);
    }

    // 4. Status + clear-button visibility.
    if (statusEl) statusEl.textContent = filterStatusText(visibleCount, active);
    if (clearBtnEl) clearBtnEl.hidden = !active;
  }

  /**
   * Empty the query and re-apply. Shared by the clear button (AC7) and the nav-clears-
   * hidden-target path (AC9/DD6) — neither moves focus; the clear button's own click
   * handler adds that step on top.
   */
  function clearQuery() {
    query = '';
    if (inputEl) inputEl.value = '';
    apply();
  }

  /**
   * Mark `sectionEl` loaded, add its `{ row, meta }` pairs to the registry, and run a full
   * `apply()` — a late-arriving vault registering under an active query is filtered the
   * moment it registers. A section that is not `isConnected` (a stale `.then` from a
   * superseded render) is ignored outright: nothing is added, and `apply()` does not run
   * (AC5).
   * @param {Element} sectionEl
   * @param {Array<{ row: Element, meta: any }>} pairs
   */
  function registerVault(sectionEl, pairs) {
    if (!sectionEl || !(/** @type {any} */ (sectionEl).isConnected)) return;
    /** @type {Element[]} */
    const rows = [];
    for (const pair of pairs || []) {
      if (!pair || !pair.row) continue;
      registry.set(pair.row, pair.meta);
      rows.push(pair.row);
    }
    sectionRows.set(sectionEl, rows);
    // AC10 (live region): scope `aria-live="off"` onto this section HERE — set
    // dynamically by the controller, never in vault.html. `#vault-root` carries
    // `aria-live="polite"`; a NEARER `aria-live` on this section overrides it for the
    // section itself and every descendant (rows, subsections) that carries no closer
    // aria-live of its own — exactly the elements the filter's apply() toggles. This
    // does NOT touch the section's own initial content-population announcement: by the
    // time registerVault runs, renderItems/renderUnknownItems have already populated the
    // rows against the still-"polite" section (the vault-loaded announcement, unaffected)
    // — only SUBSEQUENT filter-driven toggles (every later apply()) are muted. Only ever
    // set on a filter-managed (unlocked, loaded) vault section — Settings, the "Vaults"
    // group header, and a LOCKED vault section are never registered, so their
    // announcement behavior is untouched (the AC10 "no change beyond what the leg
    // documents" bound).
    if (typeof (/** @type {any} */ (sectionEl).setAttribute) === 'function') {
      /** @type {any} */ (sectionEl).setAttribute('aria-live', 'off');
    }
    // Review fix (finding 1): `aria-live="off"` on the section would otherwise also mute
    // every DIRECT child that is NOT filter-managed — today that's the title-row header
    // (static; harmless either way) and, for a jar vault, `.vault-accesskeys`, whose
    // `refreshKeys()` rewrites its own list asynchronously on every mint/revoke and must
    // stay announced (a regression AC10 forbids: "must not change announcement behavior
    // for any non-filter render"). Re-declare `aria-live="polite"` on every child that
    // does NOT carry SUBSECTION_CLASS — a nearer `aria-live` again wins locally for that
    // child and its own descendants, restoring the root's `polite` inheritance there,
    // while every `.vault-type-subsection` (including "Other items") stays covered by the
    // section's `off`. Class-based, not a `.vault-accesskeys`-only special case, so a
    // future non-filter-managed child of `buildVaultSection` is covered with no edit here.
    const nonFilterChildren = /** @type {any} */ (sectionEl).children || [];
    for (const child of nonFilterChildren) {
      if (
        child.classList &&
        typeof child.classList.contains === 'function' &&
        child.classList.contains(SUBSECTION_CLASS)
      ) {
        continue;
      }
      if (typeof child.setAttribute === 'function') child.setAttribute('aria-live', 'polite');
    }
    apply();
  }

  /**
   * Clear the query, the row registry, and the loaded-section set, and drop the field
   * refs. Called by `render()` BEFORE it rebuilds `#vault-root` (AC8/DD4) — every render's
   * old rows/sections are about to be destroyed, so there is nothing left to `apply()`
   * against; the next `buildField()` starts from an empty, unbuilt state.
   */
  function reset() {
    query = '';
    registry.clear();
    sectionRows.clear();
    inputEl = null;
    clearBtnEl = null;
    statusEl = null;
  }

  /**
   * Build the field wrapper: a labeled text input (`#vault-filter`), a clear button
   * (`#vault-filter-clear`, hidden while the field is empty), and the status line
   * (`#vault-filter-status`, `role="status"`). Called only while the page is unlocked
   * (DD3/DD4 — the caller gates this at `render()`'s call site) and always right after
   * `reset()`, so it always starts empty. All text via `textContent`; the word is "filter"
   * everywhere — never "search", and never `type="search"` (that maps to the `searchbox`
   * role and brings a native cancel control that would compete with ours).
   * @returns {HTMLElement}
   */
  function buildField() {
    const wrap = document.createElement('div');
    wrap.className = 'vault-filter-field';

    const label = document.createElement('label');
    label.className = 'vault-filter-label';
    const labelText = document.createElement('span');
    labelText.className = 'vault-filter-label-text';
    labelText.textContent = 'Filter items';
    label.appendChild(labelText);

    const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
    input.type = 'text';
    input.id = 'vault-filter';
    input.className = 'vault-filter-input';
    input.value = query;
    input.setAttribute('autocomplete', 'off');
    label.appendChild(input);
    wrap.appendChild(label);

    const clearBtn = /** @type {HTMLButtonElement} */ (document.createElement('button'));
    clearBtn.type = 'button';
    clearBtn.id = 'vault-filter-clear';
    clearBtn.className = 'vault-filter-clear';
    clearBtn.setAttribute('aria-label', 'Clear filter');
    clearBtn.title = 'Clear filter';
    clearBtn.textContent = '×';
    clearBtn.hidden = true;
    wrap.appendChild(clearBtn);

    const status = document.createElement('p');
    status.id = 'vault-filter-status';
    status.className = 'vault-filter-status';
    status.setAttribute('role', 'status');
    wrap.appendChild(status);

    inputEl = input;
    clearBtnEl = clearBtn;
    statusEl = status;

    input.addEventListener('input', () => {
      query = input.value;
      apply();
    });
    clearBtn.addEventListener('click', () => {
      clearQuery();
      input.focus();
    });

    return wrap;
  }

  // AC9/DD6: a capture-phase click listener on the nav, installed ONCE here at
  // construction (never per-render) — a click on a nav entry whose target section is
  // currently filtered out clears the filter (AC7's body, no focus move) before the
  // default hash navigation runs; the listener never calls preventDefault, so the browser's
  // own hash jump proceeds unprevented, landing on the now-visible section.
  navEl.addEventListener(
    'click',
    (ev) => {
      const anchor = closestVaultAnchor(/** @type {any} */ (ev.target));
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      const id = href.slice(1);
      const section = findLoadedSectionById(id);
      if (section && !ownVisible(section)) clearQuery();
    },
    true
  );

  return {
    buildField,
    registerVault,
    reset,
    apply,
    query: () => query
  };
}
