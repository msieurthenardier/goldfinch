// Imports use the page's SERVING paths, not disk paths: this file is served at
// goldfinch://jars/jars.js and its shared dependencies as flat sibling
// subresources (INTERNAL_PAGES is an exact-match flat map — a disk-true
// ../../shared/*.js specifier would 404 at boot). tsc cannot resolve the flat
// specifiers against the disk layout (TS2307), so each carries @ts-ignore;
// the bindings type as `any`, matching the ambient-global typing they replace
// (M07 Flight 2 leg 5 FD ruling; backlog-noted for a future typing cycle).
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { BURNER } from './burner.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { buildJarPageModel, PALETTE, pickNewJarColor } from './jar-page-model.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { JAR_DATA_CLASSES } from './jar-data-classes.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { isSafeColor } from './safe-color.js';

/**
 * jars.js — the goldfinch://jars internal page controller.
 *
 * Flight 3 shipped a flat editable row list. Flight 4 Leg 2 reworks the DOM half
 * into a settings-style master-detail layout (DD1): a dynamic left nav + one
 * always-expanded `<section>` per jar (including a read-only Burner section,
 * DD7), with instant-apply inline rename/recolor replacing the old edit-mode
 * row (DD6). The state half is unchanged: `state = { containers, defaultId }`
 * is a persisted mirror of the last broadcast/boot read (module-scope) —
 * render() is a pure function of `state` plus the transient `ui` object, so a
 * UI-only action (opening the create panel) can re-render without a fresh IPC
 * round trip. `ui = { mode, rowId, action, draft }` tracks AT MOST one open
 * transient surface at a time (`mode` is 'create' | 'confirm' | null) —
 * exclusivity is enforced by construction, since opening any transient surface
 * always replaces `ui` wholesale. Confirm `action` is 'delete' (its own
 * mechanism, unchanged) or one of the DATA_ACTIONS keys (`clear-cookies` /
 * `clear-storage` / `clear-cache` / `wipe`, Flight 4 Leg 3 / DD5) — every data
 * action shares ONE data-confirm area per section, rendered below the
 * always-visible button row and diffed on the open `(action, rowId)` pair
 * (updateDataConfirmArea), not on a boolean like the delete area's
 * updateDeleteArea. Every render() reconciles `ui` against the fresh row set:
 * if the row a confirm was open for no longer exists (deleted from another
 * surface), the transient state collapses silently, without error.
 *
 * Rendering reconciles PER-SECTION, keyed by jar id — existing sections/nav
 * entries are updated in place (never wholesale-rebuilt), so a re-render never
 * clobbers a focused name input's value/caret, a focused swatch grid's
 * aria-checked state, or a focused nav link (the uniform focus rule — one rule,
 * three appearances, no per-widget carve-outs). The create panel follows the
 * same principle at a coarser grain: it is rebuilt only on an actual ui-mode
 * transition (open/close), never on a state-only render pass, so typing in it
 * survives an unrelated broadcast.
 *
 * The create panel's DOM POSITION is likewise a single stable node, never
 * torn down and recreated (HAT step-2 finding F4): it is not part of the row
 * model, so it lives outside sectionMap and is anchored explicitly into
 * #jars-sections immediately before the Burner section (anchorCreatePanel),
 * one conditional insertBefore call per render — the form renders exactly
 * where its result (the new jar's section) will land, and a section inserted
 * while the panel is open lands before it, never disturbing focus/caret
 * inside an open panel.
 *
 * CSP: served as a same-origin subresource under default-src 'self' (no
 * 'unsafe-inline'). NO inline event handlers; NO dynamic <script>/<style>
 * injection. All DOM is built with createElement + textContent (names are
 * model-controlled but rendered as text regardless); dot/swatch colors are set
 * only after an isSafeColor check (defense in depth — the store already clamps
 * on write).
 *
 * Broadcast-before-resolve (F2-observed, renderer.js:2710-2716): a mutation's
 * jars-changed broadcast can arrive BEFORE its own invoke() resolves. Rendering
 * therefore NEVER reads from an invoke's resolved value — only from `state`, which
 * is updated exclusively by the boot read and the onJarsChanged subscription.
 * Invoke results are used only as success/failure signals (and, on success, to
 * close/clear the transient UI that triggered them).
 */

(function () {
  // The bridge only exists on the genuine goldfinch://jars origin.
  const bridge = window.goldfinchInternal;
  if (!bridge) return;

  const sectionsEl = /** @type {HTMLElement|null} */ (document.getElementById('jars-sections'));
  const navEl = /** @type {HTMLElement|null} */ (document.getElementById('jars-nav'));
  const newBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('jars-new'));
  const pageErrorEl = /** @type {HTMLElement|null} */ (document.getElementById('jars-page-error'));
  if (!sectionsEl || !navEl || !newBtn || !pageErrorEl) return;

  // The create panel is built here (not as static markup in jars.html) and
  // anchored dynamically into #jars-sections, immediately before the Burner
  // section — HAT step-2 finding F4: the form must render where its result
  // (the new jar's section) lands, and that position depends on the
  // persistent-jar count, so it can't be a fixed spot in static HTML. It is
  // ONE stable node for the page's lifetime: never recreated, and never
  // detached-then-reattached — only repositioned via a single conditional
  // insertBefore move (see anchorCreatePanel), which — like every other
  // insertBefore reposition on this page (renderSections' own note below) —
  // never disturbs focus/caret inside it. Its CONTENTS are still rebuilt
  // only on an actual ui.mode open/close transition (renderCreatePanel /
  // maybeRenderCreatePanel, unchanged from Leg 2).
  const createPanelEl = document.createElement('div');
  createPanelEl.id = 'jars-create-panel';

  const FALLBACK_COLOR = '#9aa0ac';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Build a decorative inline icon (Lucide-style: 24x24 viewBox, 16x16 render
   * size, stroke=currentColor so it inherits the button's text color — same
   * convention already used for the static toolbar/pin-toggle icons in
   * index.html and settings.html). Built entirely via createElementNS — NEVER
   * innerHTML/a template string — matching this page's textContent-only CSP
   * convention (module doc comment). Restored from Flight 3's implementation
   * (removed as dead code in Leg 2; reinstated at HAT step-1 finding F3 for
   * the delete button's trash icon — git show 4e1d980:src/renderer/pages/jars.js).
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

  // Lucide "trash-2" path data (ISC license) — same icon set/style already
  // vendored as static SVG for the toolbar and pin-toggle buttons, and as
  // Flight 3's icon-only delete button (git show 4e1d980).
  /** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
  const ICON_DELETE = [
    { tag: 'path', attrs: { d: 'M3 6h18' } },
    { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
    { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
    { tag: 'line', attrs: { x1: '10', x2: '10', y1: '11', y2: '17' } },
    { tag: 'line', attrs: { x1: '14', x2: '14', y1: '11', y2: '17' } }
  ];

  /** @typedef {{ containers: Array<any>, defaultId: (string|null) }} JarsState */
  /** @typedef {{ mode: ('create'|'confirm'|null), rowId: (string|null), action: (string|null), draft: ({name: string, color: string}|null) }} UiState */
  /** @typedef {{ id: string, name: string, color: string, isDefault: boolean, isBurner: boolean }} JarRow */

  /** @type {JarsState} */
  let state = { containers: [], defaultId: null };
  /** @type {UiState} */
  let ui = { mode: null, rowId: null, action: null, draft: null };

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** @param {string} text */
  function setPageError(text) {
    pageErrorEl.textContent = text;
  }

  function clearPageError() {
    pageErrorEl.textContent = '';
  }

  // A data-action success note stays on screen for a few seconds before
  // self-clearing (Acceptable Variation — timing is HAT-adjustable).
  const DATA_STATUS_OK_TTL_MS = 4000;

  /**
   * Write to a section's shared status line (`refs.errorLine`, aria-live —
   * reused for rename/recolor/set-default errors AND data-action success
   * notes). `ok` toggles the `is-ok` modifier class so a success note never
   * renders in the error color (review finding). Message discipline:
   * last-write-wins (any call supersedes a pending timer), and a
   * timeout-based clear only fires if the content is UNCHANGED since it was
   * set (so a later message is never stomped by an earlier message's timer).
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

  /** Collapse any open transient state (create/confirm) and re-render. */
  function closeTransient() {
    ui = { mode: null, rowId: null, action: null, draft: null };
    render();
  }

  /**
   * A reusable swatch grid: a role="radiogroup" of role="radio" buttons, one per
   * color, aria-checked against `getSelected()`. `onSelect` mutates the caller's
   * state directly — the grid updates its own aria-checked/selected state in
   * place via its internal paint() (called synchronously right after onSelect,
   * in the same click handler), so a section's swatch click can give instant
   * visual feedback without waiting for a broadcast re-render. Reused as-is from
   * Flight 3 (leg spec: unchanged) by both the create panel and each section.
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
   * Patch an existing swatch grid's aria-checked/selected state in place, for
   * the uniform focus rule (a focused grid is never wholesale-rebuilt) and for
   * reverting a failed instant-apply recolor (no broadcast arrives on failure,
   * so nothing else would repaint it). Duplicates buildSwatchGrid's internal
   * paint() logic (that function exposes no repaint hook, and the leg spec
   * requires reusing it unmodified) rather than a full rebuild.
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
   * Color list for a section's recolor swatch grid: the curated PALETTE, plus
   * the row's current color as a trailing 13th "current" swatch when it isn't
   * already a palette member (legacy/migrated jars — leg spec edge case).
   * @param {string} currentColor
   * @returns {readonly string[]}
   */
  function editColors(currentColor) {
    return PALETTE.includes(currentColor) ? PALETTE : [...PALETTE, currentColor];
  }

  // ---------------------------------------------------------------------------
  // Nav (dynamic left link-tree, DD1)
  // ---------------------------------------------------------------------------

  /** @typedef {{ li: HTMLElement, a: HTMLAnchorElement, dot: HTMLElement, nameSpan: HTMLElement, badge: HTMLElement }} NavEntry */

  /** @type {Map<string, NavEntry>} */
  const navMap = new Map();

  /**
   * @param {JarRow} row
   * @returns {NavEntry}
   */
  function buildNavEntry(row) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#jar-' + row.id;

    const dot = document.createElement('span');
    dot.className = 'jar-dot jar-nav-dot';
    a.appendChild(dot);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'jar-nav-name';
    a.appendChild(nameSpan);

    const badge = document.createElement('span');
    badge.className = 'jar-nav-badge';
    badge.textContent = 'Default';
    a.appendChild(badge);

    li.appendChild(a);
    const entry = { li, a, dot, nameSpan, badge };
    updateNavEntry(entry, row);
    return entry;
  }

  /**
   * @param {NavEntry} entry
   * @param {JarRow} row
   */
  function updateNavEntry(entry, row) {
    entry.dot.style.background = isSafeColor(row.color) ? row.color : FALLBACK_COLOR;
    entry.nameSpan.textContent = row.name;
    entry.badge.hidden = !row.isDefault;
  }

  /**
   * Rebuild/reconcile the nav from the fresh row set. Wholesale-rebuilt each
   * pass UNLESS a nav link currently holds focus (uniform focus rule) — in that
   * case entries are patched/reordered in place via insertBefore, which never
   * loses focus on an element that stays attached to the document.
   * @param {JarRow[]} rows
   */
  function renderNav(rows) {
    const focusedInNav = document.activeElement instanceof Node && navEl.contains(document.activeElement);

    if (!focusedInNav) {
      navEl.textContent = '';
      navMap.clear();
      for (const row of rows) {
        const entry = buildNavEntry(row);
        navMap.set(row.id, entry);
        navEl.appendChild(entry.li);
      }
      return;
    }

    const rowIds = new Set(rows.map((r) => r.id));
    for (const id of Array.from(navMap.keys())) {
      if (!rowIds.has(id)) {
        navMap.get(id).li.remove();
        navMap.delete(id);
      }
    }

    let prevLi = null;
    for (const row of rows) {
      let entry = navMap.get(row.id);
      if (!entry) {
        entry = buildNavEntry(row);
        navMap.set(row.id, entry);
      } else {
        updateNavEntry(entry, row);
      }
      if (prevLi == null) {
        if (navEl.firstChild !== entry.li) navEl.insertBefore(entry.li, navEl.firstChild);
      } else if (prevLi.nextSibling !== entry.li) {
        navEl.insertBefore(entry.li, prevLi.nextSibling);
      }
      prevLi = entry.li;
    }
  }

  /**
   * Mark the nav link for the given section id as current; clear all others
   * (the scroll-spy's setActive — settings.js:61-69 pattern).
   * @param {string} sectionElementId e.g. "jar-personal"
   */
  function setActiveNav(sectionElementId) {
    const rowId = sectionElementId.slice('jar-'.length);
    for (const [id, entry] of navMap) {
      if (id === rowId) {
        entry.a.setAttribute('aria-current', 'true');
      } else {
        entry.a.removeAttribute('aria-current');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll-spy (settings.js:40-100 IntersectionObserver pattern, adapted for
  // dynamic sections — re-observe only when the section SET changes)
  // ---------------------------------------------------------------------------

  /** @type {IntersectionObserver|null} */
  let scrollObserver = null;
  /** @type {string|null} */
  let lastSectionsKey = null;

  /**
   * @param {JarRow[]} rows
   */
  function observeSectionsIfChanged(rows) {
    const key = rows.map((r) => r.id).join('|');
    if (key === lastSectionsKey) return;
    lastSectionsKey = key;

    if (scrollObserver) scrollObserver.disconnect();

    const sections = rows.map((r) => sectionMap.get(r.id).root);
    if (!sections.length) {
      scrollObserver = null;
      return;
    }

    /** @type {Set<string>} */
    const visible = new Set();
    scrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        for (const section of sections) {
          if (visible.has(section.id)) {
            setActiveNav(section.id);
            return;
          }
        }
      },
      { rootMargin: '0px 0px -50% 0px', threshold: 0 }
    );
    for (const section of sections) scrollObserver.observe(section);
  }

  // ---------------------------------------------------------------------------
  // Sections (one always-expanded <section> per jar, keyed by id)
  // ---------------------------------------------------------------------------

  /**
   * @typedef {{
   *   root: HTMLElement, isBurner: boolean, row: (JarRow|null),
   *   dot: HTMLElement, h2: HTMLElement, pill: HTMLElement,
   *   nameInput?: HTMLInputElement, swatchContainer?: HTMLElement,
   *   swatchGrid?: (HTMLElement|null), errorLine?: HTMLElement,
   *   makeDefaultBtn?: HTMLButtonElement, deleteArea?: HTMLElement,
   *   deleteConfirmOpen?: boolean, pendingColor?: (string|null),
   *   dataButtons?: Map<string, HTMLButtonElement>, dataConfirmArea?: HTMLElement,
   *   dataConfirmOpenKey?: (string|null), statusClearHandle?: (number|null),
   *   nameDirty?: boolean
   * }} SectionRefs
   */

  /** @type {Map<string, SectionRefs>} */
  const sectionMap = new Map();

  /**
   * Build the always-expanded section for a persistent (non-Burner) jar:
   * header (dot + name + a header-slot occupied by EITHER the Default pill OR
   * the "Make default" text button — HAT step-1 finding F1: the button moved
   * into the same slot the pill occupies, so only one of the two is ever
   * visible, toggled via `.hidden` in updateJarSection; both stay attached to
   * the header permanently, which is what keeps the swap in place instead of
   * a rebuild), inline name input + swatch grid (instant apply, DD6), the
   * data-controls block (button row + shared confirm area, DD5/leg 3), and
   * Delete. "Make default" stays a text button (F3 HAT ruling).
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

    const dataControls = buildDataControlsBlock(row.id);
    section.appendChild(dataControls.root);

    const deleteArea = document.createElement('div');
    deleteArea.className = 'jar-delete-area';
    section.appendChild(deleteArea);

    /** @type {SectionRefs} */
    const refs = {
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
      deleteArea,
      deleteConfirmOpen: undefined,
      pendingColor: null,
      dataButtons: dataControls.buttons,
      dataConfirmArea: dataControls.confirmArea,
      dataConfirmOpenKey: undefined,
      statusClearHandle: null,
      nameDirty: false
    };

    makeDefaultBtn.addEventListener('click', () => handleSetDefault(row.id));

    // Dirty tracking (HAT review fix): ONLY this listener sets nameDirty, so it
    // fires exclusively on operator keystrokes, never on a programmatic
    // `.value =` assignment (the sync paths below assign directly and do not
    // dispatch `input`). commitOrRevertName below uses this flag — not a
    // stale-vs-store diff — to tell an operator edit apart from a focused
    // input's display having gone stale under it via broadcast.
    nameInput.addEventListener('input', () => {
      refs.nameDirty = true;
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Input-level Escape wins over the global transient-dismiss handler —
        // revert + blur, and stop the event from reaching it (leg spec AC).
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

    // Uniform focus rule: a focused name input's value is never overwritten by
    // a render pass — it syncs on blur (via commitOrRevertName) instead. That
    // deferred sync only actually runs the display-catchup branch (not a
    // commit) when the input is clean (nameDirty is false) — see
    // commitOrRevertName.
    if (document.activeElement !== refs.nameInput) {
      refs.nameInput.value = row.name;
    }
    refs.nameInput.setAttribute('aria-label', `Name for ${row.name}`);

    updateSwatchGrid(refs, row);
    updateDataConfirmArea(refs, row);
    updateDeleteArea(refs, row);
  }

  /**
   * Swatch grid update path (leg spec guidance #5): if the grid holds
   * document.activeElement, patch aria-checked/selected in place (uniform
   * focus rule); otherwise rebuilding is fine (the 13th "current" swatch's
   * membership can change as the store color changes).
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
   * Instant-apply recolor (DD6): mutates no local draft — invokes jarsRename
   * directly. `pendingColor` is a short-lived optimistic value read by the
   * swatch grid's own getSelected() so the click's own paint() (called
   * synchronously right after this) shows the pick immediately, without
   * waiting for the broadcast. Reverted on failure (no broadcast arrives to
   * self-correct it).
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
        // Success: state already reflects the change (broadcast-before-resolve
        // — module doc comment) by the time this resolves in most cases; the
        // update path syncs the grid on the next render regardless.
      })
      .catch(() => {
        refs.pendingColor = null;
        setSectionStatus(refs, "Couldn't update jar", false);
        syncSwatchSelection(refs.swatchGrid, refs.row ? refs.row.color : color);
      });
  }

  /**
   * Commit-or-revert a section's name input (Enter and blur share this path).
   *
   * The input's own `input` listener is the ONLY thing that sets
   * `refs.nameDirty` — so it is true iff the operator typed since the last
   * commit/revert/sync. A focused input never gets its `.value` overwritten by
   * a render pass (uniform focus rule); instead the store can move out from
   * under it (another page's rename arrives via broadcast) while the display
   * stays stale. If the input is NOT dirty, that staleness — not an edit — is
   * the only thing that could be pending, so this is the deferred sync
   * completing: catch the display up to the current store name and return
   * WITHOUT calling jarsRename (doing otherwise would re-commit the stale
   * display and silently clobber whatever the other page just wrote).
   *
   * When the input IS dirty, only invoke jarsRename if the trimmed value is
   * non-empty and differs from the store name (page-side trim is the SOLE
   * whitespace enforcement — F3 ruling carried forward); a whitespace-only or
   * no-op edit reverts to the store name in place. Every exit path below
   * clears nameDirty — a commit/revert always leaves the input clean.
   * @param {string} id
   * @param {SectionRefs} refs
   */
  function commitOrRevertName(id, refs) {
    const inputEl = refs.nameInput;
    const storeName = refs.row ? refs.row.name : '';
    if (!refs.nameDirty) {
      // Deferred focused-sync completing: no operator edit is pending, so
      // catch the display up to the (possibly just-broadcast) store name.
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

  // ---------------------------------------------------------------------------
  // Data controls (Leg 3, DD5): confirm-everything clear/wipe actions.
  // ---------------------------------------------------------------------------

  // Confirm copy (verbatim — flight Acceptable Variations, operator-adjustable
  // at HAT) is deliberately NAME-FREE: this is what makes the (action, rowId)
  // pair alone a sufficient transition key for updateDataConfirmArea below. If
  // a future revision interpolates the jar's name into any of these strings,
  // the transition key MUST widen to include the row's current name too — a
  // name-only change while that confirm is open would otherwise not trigger a
  // rebuild, leaving stale copy on screen.
  const CLEAR_COPY = {
    cookies: "Clears this jar's cookies. Sites in this jar will sign you out.",
    storage: "Clears this jar's site storage — data sites saved locally in this jar.",
    cache: "Clears this jar's cached files. Sites reload them on next visit."
  };
  const CLEAR_OK_NOTE = {
    cookies: 'Cookies cleared.',
    storage: 'Site storage cleared.',
    cache: 'Cache cleared.'
  };
  const WIPE_COPY =
    "Wipes this jar's cookies, site storage, and cache, and rerolls its fingerprint. Open tabs in this jar will reload.";
  const WIPE_OK_NOTE = 'Identity cleared — data wiped, fingerprint rerolled.';

  /**
   * Data-controls action table (leg spec guidance #2): one entry per confirm
   * action → { copy, run(id), okNote, failNote }. Clear-* entries derive their
   * action key, bridge call, and class list from JAR_DATA_CLASSES, so a future
   * data class needs zero new action-plumbing beyond that list; copy/okNote
   * stay literal per class (operator-facing bespoke wording, not generated
   * from the label).
   * @type {{ [action: string]: { copy: string, run: (id: string) => Promise<any>, okNote: string, failNote: string } }}
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

  /**
   * The always-visible data-controls button row + the single shared confirm
   * area below it (FD ruling; cycle-2 ACs). Buttons are ENABLED — each opens
   * its confirm via `ui` wholesale replacement (openDataConfirm); exclusivity
   * and Escape-dismiss hold automatically via the existing global handler.
   * @param {string} id
   * @returns {{ root: HTMLElement, buttons: Map<string, HTMLButtonElement>, confirmArea: HTMLElement }}
   */
  function buildDataControlsBlock(id) {
    const root = document.createElement('div');
    root.className = 'jar-data-controls';

    const buttonRow = document.createElement('div');
    buttonRow.className = 'jar-data-controls-buttons';

    /** @type {Map<string, HTMLButtonElement>} */
    const buttons = new Map();
    for (const cls of JAR_DATA_CLASSES) {
      const action = 'clear-' + cls.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jar-btn';
      btn.textContent = `Clear ${cls.label.toLowerCase()}`;
      btn.addEventListener('click', () => openDataConfirm(id, action));
      buttons.set(action, btn);
      buttonRow.appendChild(btn);
    }
    const wipeBtn = document.createElement('button');
    wipeBtn.type = 'button';
    wipeBtn.className = 'jar-btn jar-btn-danger';
    wipeBtn.textContent = 'Clear identity';
    wipeBtn.addEventListener('click', () => openDataConfirm(id, 'wipe'));
    buttons.set('wipe', wipeBtn);
    buttonRow.appendChild(wipeBtn);

    root.appendChild(buttonRow);

    const confirmArea = document.createElement('div');
    confirmArea.className = 'jar-data-confirm-area';
    root.appendChild(confirmArea);

    return { root, buttons, confirmArea };
  }

  /** @param {string} id @param {string} action */
  function openDataConfirm(id, action) {
    ui = { mode: 'confirm', rowId: id, action, draft: null };
    render();
  }

  /**
   * Build the confirm block for one data action (cycle-2 AC): action-specific
   * copy, a Confirm button, Cancel, and its own confirm-LOCAL error line
   * (delete-confirm precedent, jars.js's buildDeleteConfirm — NOT the
   * section's shared line).
   *
   * In-flight guard (cycle-2 AC (b)): Confirm disables itself AND this
   * action's trigger button (in the always-visible row) the instant it's
   * clicked — since the five buttons stay clickable while a confirm is open,
   * leaving the trigger enabled would let a second click double-fire the same
   * request. Disabling it also makes a "swap away and back to this action
   * mid-flight" impossible by construction (the trigger can't be clicked to
   * reopen it), which is the double-fire hole the sibling-visible design
   * opens. The trigger always re-enables on settle, success or failure,
   * independent of whether this confirm is still the one showing. Resolve/
   * reject additionally verify `ui` still points at THIS (action, rowId)
   * before mutating `ui` (closing the confirm) or writing the local error —
   * an abandoned promise from a swapped-away confirm must not close or
   * relabel a NEWER confirm the user opened instead.
   * @param {string} id
   * @param {string} action
   * @param {SectionRefs} refs
   * @returns {{ root: HTMLElement, confirmBtn: HTMLButtonElement }}
   */
  function buildDataConfirm(id, action, refs) {
    const entry = DATA_ACTIONS[action];
    const wrap = document.createElement('div');
    wrap.className = 'jar-confirm';

    const text = document.createElement('p');
    text.className = 'jar-confirm-text';
    text.textContent = entry.copy;
    wrap.appendChild(text);

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    errorLine.setAttribute('aria-live', 'polite');
    wrap.appendChild(errorLine);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'jar-form-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'jar-btn jar-btn-danger';
    confirmBtn.textContent = 'Confirm';

    const triggerBtn = refs.dataButtons ? refs.dataButtons.get(action) : null;

    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      if (triggerBtn) triggerBtn.disabled = true;
      entry.run(id)
        .then((result) => {
          if (triggerBtn) triggerBtn.disabled = false;
          const stillOpen = ui.mode === 'confirm' && ui.rowId === id && ui.action === action;
          if (result && result.ok) {
            setSectionStatus(refs, entry.okNote, true);
            if (stillOpen) closeTransient();
            return;
          }
          if (stillOpen) {
            errorLine.textContent = entry.failNote;
            confirmBtn.disabled = false;
          }
        })
        .catch(() => {
          if (triggerBtn) triggerBtn.disabled = false;
          const stillOpen = ui.mode === 'confirm' && ui.rowId === id && ui.action === action;
          if (stillOpen) {
            errorLine.textContent = entry.failNote;
            confirmBtn.disabled = false;
          }
        });
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeTransient());

    actionsEl.appendChild(confirmBtn);
    actionsEl.appendChild(cancelBtn);
    wrap.appendChild(actionsEl);
    return { root: wrap, confirmBtn };
  }

  /**
   * Toggle the shared data-confirm area between empty and the open action's
   * confirm block. Cycle-2 AC (a): the transition key is the open
   * `(action, rowId)` pair as a STRING-OR-NULL — NOT a boolean like
   * updateDeleteArea's `deleteConfirmOpen` — so a same-row action SWAP (e.g.
   * clear-cookies → wipe, the edge-case section's example) is itself a key
   * change and forces a rebuild; a literal boolean copy would wrongly treat
   * "still open" as "unchanged" and skip the rebuild, leaving the OLD
   * action's copy/handler on screen (cycle-2 review finding). Cycle-2 AC (c):
   * focuses the new confirm's Confirm button, gated by the key actually
   * changing, so an unrelated re-render (e.g. a sibling jar's rename
   * broadcast) never hijacks focus.
   * @param {SectionRefs} refs
   * @param {JarRow} row
   */
  function updateDataConfirmArea(refs, row) {
    const key =
      ui.mode === 'confirm' && ui.rowId === row.id && ui.action != null && DATA_ACTIONS[ui.action]
        ? ui.action + ':' + row.id
        : null;
    if (key === refs.dataConfirmOpenKey) return;
    refs.dataConfirmOpenKey = key;
    refs.dataConfirmArea.textContent = '';
    if (key === null) return;
    const built = buildDataConfirm(row.id, /** @type {string} */ (ui.action), refs);
    refs.dataConfirmArea.appendChild(built.root);
    built.confirmBtn.focus();
  }

  /**
   * Full-size text danger button with a leading trash icon (HAT step-1
   * finding F3). The icon is aria-hidden decoration (buildIcon sets it) — the
   * visible "Delete jar…" text (plus the per-jar aria-label, unchanged) is
   * what carries the accessible name, so adding the icon doesn't touch it.
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
    btn.addEventListener('click', () => openConfirmDelete(row));
    return btn;
  }

  /**
   * The in-section two-step delete confirmation (DD5 verbatim F3 copy). Only
   * Confirm calls jarsRemove; Confirm disables once clicked (handleRemove is
   * async — a double-fire would surface a needless {ok:false} inline error).
   * On success the section + nav entry disappear via the next broadcast
   * reconcile — nothing to close here.
   * @param {JarRow} row
   * @returns {HTMLElement}
   */
  function buildDeleteConfirm(row) {
    const wrap = document.createElement('div');
    wrap.className = 'jar-confirm';

    const text = document.createElement('p');
    text.className = 'jar-confirm-text';
    text.textContent = 'Deletes this jar and wipes its cookies, site storage, and cache. Open tabs in this jar will close.';
    wrap.appendChild(text);

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    errorLine.setAttribute('aria-live', 'polite');
    wrap.appendChild(errorLine);

    const actions = document.createElement('div');
    actions.className = 'jar-form-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'jar-btn jar-btn-danger';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      bridge.jarsRemove({ id: row.id })
        .then((result) => {
          if (!result || !result.ok) {
            errorLine.textContent = "Couldn't delete jar";
            confirmBtn.disabled = false;
          }
        })
        .catch(() => {
          errorLine.textContent = "Couldn't delete jar";
          confirmBtn.disabled = false;
        });
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeTransient());

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    wrap.appendChild(actions);
    return wrap;
  }

  /**
   * Toggle the delete area between the Delete button and the confirm block.
   * Only rebuilds when this row's confirm-open-ness actually changes — an
   * unrelated broadcast while the confirm is open (e.g. another jar renamed)
   * must not reset an in-flight Confirm click's disabled state.
   * @param {SectionRefs} refs
   * @param {JarRow} row
   */
  function updateDeleteArea(refs, row) {
    const shouldBeOpen = ui.mode === 'confirm' && ui.action === 'delete' && ui.rowId === row.id;
    if (shouldBeOpen === refs.deleteConfirmOpen) return;
    refs.deleteConfirmOpen = shouldBeOpen;
    refs.deleteArea.textContent = '';
    refs.deleteArea.appendChild(shouldBeOpen ? buildDeleteConfirm(row) : buildDeleteButton(row));
  }

  /**
   * Build the read-only Burner section (DD7): header line (dot + name +
   * Default pill when flagged) + the F4 hint copy. NO name input, swatches,
   * make-default, data controls, or delete — structurally driven by
   * row.isBurner (never an id === 'burner' string check in DOM code).
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
   * Reconcile #jars-sections against the fresh row set, keyed by jar id:
   * existing sections are updated in place, gone sections are removed, new
   * ones are built and inserted in model order (store order + Burner last —
   * buildJarPageModel's own ordering, so no special-casing needed here).
   * insertBefore never disturbs an already-attached node's focus, so this
   * reordering pass is safe even mid-edit.
   *
   * Burner gets its own positioning branch (F4 fix): the create panel is NOT
   * part of `rows`, but it lives in #jars-sections too (anchored just before
   * Burner — see anchorCreatePanel). If Burner were positioned via the same
   * `prevEl.nextSibling` check as every other row, an open panel sitting
   * between the last persistent section and Burner would make that check see
   * the panel instead of Burner and wrongly conclude Burner is out of place
   * on EVERY render — shuffling it before the panel, which anchorCreatePanel
   * would then have to shuffle back, on every single render pass while the
   * panel is open. Positioning Burner as sectionsEl's literal last child
   * sidesteps that: Burner is always the final row (buildJarPageModel's
   * ordering contract), so "is it already the last child" is the correct,
   * churn-free check regardless of whether the panel is currently attached
   * between it and the previous section.
   * @param {JarRow[]} rows
   */
  function renderSections(rows) {
    const rowIds = new Set(rows.map((r) => r.id));
    for (const id of Array.from(sectionMap.keys())) {
      if (!rowIds.has(id)) {
        const removed = sectionMap.get(id);
        // No timers firing into removed DOM (leg spec AC — feedback timing).
        if (removed.statusClearHandle != null) clearTimeout(removed.statusClearHandle);
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

  /**
   * Anchor the create panel immediately before the Burner section (F4 fix).
   * The panel isn't part of `rows`, so renderSections above never positions
   * it — this corrective step runs after every render (state-only or
   * ui.mode transition alike) and repositions it via ONE conditional
   * insertBefore call: a no-op in the steady-state case where it's already
   * in the right spot, and otherwise a single atomic DOM move — which, like
   * every other insertBefore reposition on this page, never disturbs a
   * currently-focused descendant, so this is safe to run even while the
   * panel holds focus (typed name / picked color mid-edit).
   *
   * Because this runs on every render, a NEW jar section inserted while the
   * panel is open lands before it automatically: renderSections' own
   * insertBefore call for that new row targets `prevEl.nextSibling`, which —
   * in the steady state this function maintains — IS the panel, so the new
   * section is slotted in right before it, and this function then finds the
   * panel already correctly placed before Burner and no-ops.
   * @param {JarRow[]} rows
   */
  function anchorCreatePanel(rows) {
    const burnerRow = rows.find((r) => r.isBurner);
    const burnerRefs = burnerRow ? sectionMap.get(burnerRow.id) : null;
    if (burnerRefs) {
      if (createPanelEl.parentNode !== sectionsEl || createPanelEl.nextSibling !== burnerRefs.root) {
        sectionsEl.insertBefore(createPanelEl, burnerRefs.root);
      }
    } else if (createPanelEl.parentNode !== sectionsEl || sectionsEl.lastChild !== createPanelEl) {
      // Defensive fallback — buildJarPageModel always appends a Burner row,
      // so this branch is not reachable in practice.
      sectionsEl.appendChild(createPanelEl);
    }
  }

  // ---------------------------------------------------------------------------
  // Create panel
  // ---------------------------------------------------------------------------

  // Tracks which mode the create panel's DOM currently reflects, so render()
  // can rebuild it ONLY on an actual open/close transition (leg spec AC) —
  // never on a state-only pass, so an in-progress create-panel edit survives
  // an unrelated jars-changed broadcast.
  /** @type {'create'|null} */
  let createPanelMode = null;

  /** Rebuild the create-panel DOM from ui (shown only while ui.mode === 'create'). */
  function renderCreatePanel() {
    createPanelEl.textContent = '';
    newBtn.textContent = ui.mode === 'create' ? 'Cancel' : '+ New jar';
    newBtn.setAttribute('aria-expanded', String(ui.mode === 'create'));
    if (ui.mode !== 'create') return;

    const draft = /** @type {{name: string, color: string}} */ (ui.draft);

    const form = document.createElement('form');
    form.className = 'jar-form';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'jar-form-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'jar-name-input';
    nameInput.maxLength = 24;
    nameInput.value = draft.name;
    nameInput.setAttribute('aria-label', 'New jar name');
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    form.appendChild(buildSwatchGrid(PALETTE, () => draft.color, (color) => { draft.color = color; }));

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    errorLine.setAttribute('aria-live', 'polite');
    form.appendChild(errorLine);

    const actions = document.createElement('div');
    actions.className = 'jar-form-actions';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'jar-btn jar-btn-primary';
    submitBtn.textContent = 'Create';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeTransient());

    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    function syncSubmitDisabled() {
      submitBtn.disabled = nameInput.value.trim() === '';
    }
    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value;
      syncSubmitDisabled();
    });
    syncSubmitDisabled();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const trimmed = draft.name.trim();
      // Page-side trim/disable is the SOLE enforcement for whitespace-only names
      // (leg spec AC) — cleanName does not trim.
      if (!trimmed) return;
      submitBtn.disabled = true;
      bridge.jarsAdd({ name: trimmed, color: draft.color })
        .then((result) => {
          if (!result) {
            errorLine.textContent = "Couldn't create jar";
            submitBtn.disabled = false;
            return;
          }
          // Success: the form resets/closes; the new jar appears via the
          // broadcast re-render (no optimistic insertion).
          closeTransient();
        })
        .catch(() => {
          errorLine.textContent = "Couldn't create jar";
          submitBtn.disabled = false;
        });
    });

    createPanelEl.appendChild(form);

    // On open, the name input receives focus and the panel is scrolled into
    // view (leg spec AC).
    nameInput.focus();
    createPanelEl.scrollIntoView({ block: 'nearest' });
  }

  /** Rebuild the create panel only when ui.mode actually transitioned to/from 'create'. */
  function maybeRenderCreatePanel() {
    const targetMode = ui.mode === 'create' ? 'create' : null;
    if (targetMode === createPanelMode) return;
    createPanelMode = targetMode;
    renderCreatePanel();
  }

  // ---------------------------------------------------------------------------
  // Transient-state open/close + set-default
  // ---------------------------------------------------------------------------

  /** @param {{ id: string, name: string, color: string }} row */
  function openConfirmDelete(row) {
    ui = { mode: 'confirm', rowId: row.id, action: 'delete', draft: null };
    render();
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

  newBtn.addEventListener('click', () => {
    if (ui.mode === 'create') {
      closeTransient();
    } else {
      ui = { mode: 'create', rowId: null, action: null, draft: { name: '', color: pickNewJarColor(PALETTE, state.containers.map((c) => c.color)) } };
      render();
    }
  });

  // Escape dismisses ANY open transient state — create panel or delete confirm
  // (FD ruling at design review: keyboard consistency across every ui.mode).
  // The name input's own keydown handler stopPropagation()s its Escape, so
  // this never double-fires against an in-progress name edit.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.mode !== null) closeTransient();
  });

  // ---------------------------------------------------------------------------
  // Render + state
  // ---------------------------------------------------------------------------

  /**
   * Reconcile `ui` against the fresh row set: an open confirm collapses
   * silently if its row id no longer exists (e.g. deleted from another
   * surface) — the F3 zero-witness path, deliberately exercised at the HAT leg.
   * @param {JarRow[]} rows
   */
  function reconcileUi(rows) {
    if (ui.mode === 'confirm' && !rows.some((r) => r.id === ui.rowId)) {
      ui = { mode: null, rowId: null, action: null, draft: null };
    }
  }

  /** Render is a pure function of `state` + `ui` — never of an invoke's resolved value. */
  function render() {
    const rows = buildJarPageModel(state.containers, state.defaultId);
    reconcileUi(rows);

    renderNav(rows);
    renderSections(rows);
    anchorCreatePanel(rows);
    observeSectionsIfChanged(rows);
    maybeRenderCreatePanel();
  }

  /**
   * Normalize jarsGetDefault()'s resolved object (a persistent jar, or a
   * structured-clone of the frozen BURNER) into the broadcast's defaultId
   * convention (string id, or null when Burner holds the flag). Compare by id,
   * never by reference — jarsGetDefault() crosses IPC as a clone (leg spec F2 DD3
   * lesson).
   * @param {{ id?: string }|null|undefined} def
   * @returns {string|null}
   */
  function normalizeDefaultId(def) {
    if (!def || typeof def.id !== 'string') return null;
    return def.id === BURNER.id ? null : def.id;
  }

  /** @param {JarsState} payload */
  function applyState(payload) {
    state = { containers: Array.isArray(payload.containers) ? payload.containers : [], defaultId: payload.defaultId };
    render();
  }

  // Boot/broadcast race (leg edge case): subscribe FIRST, then boot-read, so a
  // mutation racing the one-shot boot reads is never lost — applyState wholesale-
  // replaces `state`, so whichever arrives last wins.
  const handle = bridge.onJarsChanged((payload) => {
    if (payload && Array.isArray(payload.containers)) applyState(payload);
  });

  Promise.all([bridge.jarsList(), bridge.jarsGetDefault()])
    .then(([containers, def]) => {
      applyState({ containers: Array.isArray(containers) ? containers : [], defaultId: normalizeDefaultId(def) });
    })
    .catch(() => {});

  // Clean up on pagehide to prevent listener accumulation across electronmon
  // reloads (settings.js:138-142 pattern).
  window.addEventListener('pagehide', () => {
    bridge.offJarsChanged(handle);
    if (scrollObserver) scrollObserver.disconnect();
  }, { once: true });
})();
