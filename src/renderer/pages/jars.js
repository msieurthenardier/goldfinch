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
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { JAR_PANELS, panelForDataClass } from './jar-panel-model.js';

/**
 * jars.js — the goldfinch://jars internal page controller.
 *
 * Flight 3 shipped a flat editable row list. Flight 4 Leg 2 reworks the DOM half
 * into a settings-style master-detail layout (DD1): a dynamic left nav + one
 * always-expanded `<section>` per jar (including a read-only Burner section,
 * DD7), with instant-apply inline rename/recolor replacing the old edit-mode
 * row (DD6). Mission 08 Flight 2 Leg 2 reworks each persistent jar's section
 * again: the data-class controls and the count now live inside three
 * collapsible PANELS (History / Cookies / Other site data — DD1/DD3 of that
 * flight), default collapsed (DD4), with a live History visit count rendered
 * into the disclosure button's own label (DD6). Wipe and Delete stay OUTSIDE
 * the panels, in a section footer — jar-level identity actions, not
 * data-class actions.
 *
 * The state half is unchanged: `state = { containers, defaultId }` is a
 * persisted mirror of the last broadcast/boot read (module-scope) — render()
 * is a pure function of `state` plus the transient `ui` object, so a UI-only
 * action (opening the create panel) can re-render without a fresh IPC round
 * trip. `ui = { mode, rowId, action, draft }` tracks AT MOST one open
 * transient surface at a time (`mode` is 'create' | 'confirm' | null) —
 * exclusivity is enforced by construction, since opening any transient surface
 * always replaces `ui` wholesale. Confirm `action` is one of the DATA_ACTIONS
 * keys — `clear-cookies` / `clear-storage` / `clear-cache` / `wipe` / `delete`
 * (Flight 2 Leg 2 folded delete's own two-step confirm into this same table,
 * with a `silentSuccess` flag preserving its historic no-op-on-success
 * behavior — see DATA_ACTIONS below). Each action is routed by
 * `regionForAction` into exactly one of three PER-REGION confirm areas
 * (cookies / site-data / footer) — every region is still gated by the ONE
 * global `ui` singleton (exclusivity unchanged: opening any confirm anywhere
 * replaces `ui` wholesale, so at most one region ever shows an open confirm),
 * and each region diffs its own open `(action, rowId)` key independently
 * (`updateConfirmAreas`) — the M06 F4 DD6 focus-preserving discipline
 * extended to regions. Every render() reconciles `ui` against the fresh row
 * set: if the row a confirm was open for no longer exists (deleted from
 * another surface), the transient state collapses silently, without error.
 *
 * Rendering reconciles PER-SECTION, keyed by jar id — existing sections/nav
 * entries are updated in place (never wholesale-rebuilt), so a re-render never
 * clobbers a focused name input's value/caret, a focused swatch grid's
 * aria-checked state, a focused nav link, or an open panel/confirm (the
 * uniform focus rule — one rule, several appearances, no per-widget
 * carve-outs). The create panel follows the same principle at a coarser
 * grain: it is rebuilt only on an actual ui-mode transition (open/close),
 * never on a state-only render pass, so typing in it survives an unrelated
 * broadcast.
 *
 * Panels (DD3): each panel is the standard WAI-ARIA disclosure pattern —
 * `h3 > button[aria-expanded]` + `role="region"` `aria-labelledby`-linked
 * content div, NOT `<details>` (full control of the reconcile + CSS). Panel
 * open/closed state lives in the section's `SectionRefs.panelOpen` map,
 * diffed nowhere — render() NEVER touches `panelOpen` or panel DOM (static
 * labels/content give it nothing to reconcile there beyond
 * `updateConfirmAreas`), so toggling is a pure, synchronous, render-free
 * click-handler concern: read `ui` → `closeTransient()` if collapsing a panel
 * that owns the open confirm → flip `panelOpen` + `aria-expanded` + `hidden`
 * on the same live nodes. This is what makes an expanded panel — or an open
 * confirm inside it — survive an unrelated `jars-changed`/`history-changed`
 * broadcast.
 *
 * History count (DD6): the count renders ONLY inside the History panel's
 * disclosure-button label (a `<span>` patched in place), glanceable while
 * collapsed. **INVARIANT**: render()/updateJarSection NEVER write this span —
 * the count isn't derivable from `row`/`state`, so a render-path write would
 * blank it on every unrelated broadcast with nothing to restore it. The ONLY
 * two writers are `fetchHistoryCount`'s call sites: build-time (uniform for
 * every section, boot-time and jarsAdd-created alike) and the module-level
 * `onHistoryChanged` handler (invalidation-signal semantics — re-query on
 * `{ jarId }`, never trust payload data).
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
   * notes, regardless of which panel/region triggered them). `ok` toggles the
   * `is-ok` modifier class so a success note never renders in the error color
   * (review finding). Message discipline: last-write-wins (any call
   * supersedes a pending timer), and a timeout-based clear only fires if the
   * content is UNCHANGED since it was set (so a later message is never
   * stomped by an earlier message's timer).
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
  // dynamic sections — re-observe only when the section SET changes). DD7:
  // panel collapse changes scroll geometry but never the section SET, so this
  // is unaffected by the panel relayout.
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
   *   makeDefaultBtn?: HTMLButtonElement, pendingColor?: (string|null),
   *   dataButtons?: Map<string, HTMLButtonElement>,
   *   confirmAreas?: Map<string, HTMLElement>,
   *   confirmOpenKeys?: Map<string, (string|null)>,
   *   panelOpen?: Map<string, boolean>,
   *   panelRefs?: Map<string, { button: HTMLButtonElement, region: HTMLElement, countSpan?: HTMLElement }>,
   *   statusClearHandle?: (number|null), nameDirty?: boolean
   * }} SectionRefs
   */

  /** @type {Map<string, SectionRefs>} */
  const sectionMap = new Map();

  /**
   * One region's always-visible button row + its own confirm area below it
   * (leg spec #4/#8) — reused verbatim for the Cookies panel, the
   * Other-site-data panel, and the section footer; no per-region singleton
   * selectors (design review verified reuse is safe).
   * @returns {{ root: HTMLElement, buttonRow: HTMLElement, confirmArea: HTMLElement }}
   */
  function buildRegionControls() {
    const root = document.createElement('div');
    root.className = 'jar-data-controls';
    const buttonRow = document.createElement('div');
    buttonRow.className = 'jar-data-controls-buttons';
    root.appendChild(buttonRow);
    const confirmArea = document.createElement('div');
    confirmArea.className = 'jar-data-confirm-area';
    root.appendChild(confirmArea);
    return { root, buttonRow, confirmArea };
  }

  /**
   * Full-size text danger button with a leading trash icon (HAT step-1
   * finding F3). The icon is aria-hidden decoration (buildIcon sets it) — the
   * visible "Delete jar…" text (plus the per-jar aria-label, unchanged) is
   * what carries the accessible name. Lives in the section FOOTER now (DD1),
   * beside "Clear identity" — its click opens the generic data-confirm
   * machinery under action 'delete' (folded in, Flight 2 Leg 2), same as
   * every other DATA_ACTIONS trigger.
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
   * Build the always-expanded section for a persistent (non-Burner) jar:
   * header (dot + name + a header-slot occupied by EITHER the Default pill OR
   * the "Make default" text button — HAT step-1 finding F1), inline name
   * input + swatch grid (instant apply, DD6), THREE collapsible panels
   * (History / Cookies / Other site data — Flight 2 Leg 2 / DD1/DD3, default
   * collapsed per DD4), and a footer hosting Wipe + Delete (jar-level
   * identity actions, outside all panels — DD1). "Make default" stays a text
   * button (F3 HAT ruling).
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

    // -------------------------------------------------------------------
    // Panels block (Flight 2, Leg 2 / DD1/DD3): one collapsible panel per
    // JAR_PANELS entry, in JAR_PANELS order, default collapsed (DD4),
    // between the name/swatch area and the footer. ⚠ DOUBLE-HYPHEN
    // separator is load-bearing (design review, HIGH): a single hyphen
    // collides — slug() can mint a jar id ENDING in a panel token (jar
    // "Personal" + jar "Personal Cookies" → single-hyphen "jar-personal-
    // cookies" would be BOTH jar-Personal's cookies region and jar-Personal-
    // Cookies' own section id). slug() collapses non-alnum runs to a single
    // '-' and never emits '--', so 'jar-<id>--<panel>' cannot collide.
    // -------------------------------------------------------------------

    /** @type {Map<string, HTMLButtonElement>} */
    const dataButtons = new Map();
    /** @type {Map<string, HTMLElement>} */
    const confirmAreas = new Map();
    /** @type {Map<string, (string|null)>} */
    const confirmOpenKeys = new Map();
    /** @type {Map<string, boolean>} */
    const panelOpen = new Map();
    /** @type {Map<string, { button: HTMLButtonElement, region: HTMLElement, countSpan?: HTMLElement }>} */
    const panelRefs = new Map();
    // regionId ('cookies' | 'site-data') -> its panel's button row, so the
    // JAR_DATA_CLASSES loop below can route each clear-* button in (leg spec #3).
    /** @type {Map<string, HTMLElement>} */
    const panelButtonRows = new Map();

    for (const panel of JAR_PANELS) {
      const headingId = 'jar-' + row.id + '--' + panel.id + '-heading';
      const regionId = 'jar-' + row.id + '--' + panel.id;

      const panelEl = document.createElement('div');
      panelEl.className = 'jar-panel';
      panelEl.dataset.panel = panel.id;

      const heading = document.createElement('h3');
      heading.className = 'jar-panel-heading';
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'jar-panel-toggle';
      toggleBtn.id = headingId;
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-controls', regionId);
      toggleBtn.appendChild(document.createTextNode(panel.label));

      // History's count suffix (DD6) lives in its own <span> inside the
      // button so label patching is targeted — see fetchHistoryCount. Every
      // other panel's label is the static panel.label alone; render()/
      // updateJarSection never touch this span (module doc INVARIANT).
      /** @type {HTMLElement|undefined} */
      let countSpan;
      if (panel.id === 'history') {
        countSpan = document.createElement('span');
        countSpan.className = 'jar-panel-count';
        toggleBtn.appendChild(countSpan);
      }
      heading.appendChild(toggleBtn);
      panelEl.appendChild(heading);

      const region = document.createElement('div');
      region.id = regionId;
      region.setAttribute('role', 'region');
      region.setAttribute('aria-labelledby', headingId);
      region.className = 'jar-panel-region';
      region.hidden = true;

      if (panel.id === 'history') {
        // Flight 3 territory (browse/search/delete); this flight renders
        // only the count (button label, above) + a short hint (DD1/DD5).
        const hint = document.createElement('p');
        hint.className = 'jar-panel-hint';
        hint.textContent = 'Detailed browsing history for this jar is coming in a later flight.';
        region.appendChild(hint);
      } else {
        const controls = buildRegionControls();
        panelButtonRows.set(panel.id, controls.buttonRow);
        confirmAreas.set(panel.id, controls.confirmArea);
        confirmOpenKeys.set(panel.id, null);
        region.appendChild(controls.root);
      }

      panelEl.appendChild(region);
      section.appendChild(panelEl);

      panelOpen.set(panel.id, false);
      panelRefs.set(panel.id, { button: toggleBtn, region, countSpan });

      // Toggle handler (leg spec #2, verification-steps ordering): read
      // `ui` -> closeTransient() (only if collapsing a panel that owns the
      // open confirm) -> flip state/aria/hidden on the SAME live nodes.
      // Expansion/collapse itself never rebuilds region content — render()
      // is never invoked here except via closeTransient's own re-render,
      // which patches confirm areas in place and does not touch panelOpen
      // or panel DOM. Two rapid toggles: a plain boolean flip, no async —
      // last one wins.
      toggleBtn.addEventListener('click', () => {
        const willOpen = !panelOpen.get(panel.id);
        if (
          !willOpen &&
          ui.mode === 'confirm' &&
          ui.rowId === row.id &&
          regionForAction(ui.action) === panel.id
        ) {
          closeTransient();
        }
        panelOpen.set(panel.id, willOpen);
        region.hidden = !willOpen;
        toggleBtn.setAttribute('aria-expanded', String(willOpen));
      });
    }

    // Clear-* buttons route into their panel via panelForDataClass (leg
    // spec #3) — data-driven, so a future JAR_DATA_CLASSES entry (Flight
    // 3's "history" class) slots into the right panel with no new wiring.
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

    // Footer (DD1): Wipe ("Clear identity") + Delete are jar-LEVEL identity
    // actions, outside all panels — rendered side by side (leg spec #3),
    // sharing the same per-region confirm-area machinery under regionId
    // 'footer'. The delete button MUST be registered in `dataButtons` (design
    // review): it now stays visible beside its own open confirm, so the
    // trigger-disable guard in buildDataConfirm is load-bearing against
    // double-fire for delete, exactly as it already is for wipe/clear-*.
    const footer = document.createElement('div');
    footer.className = 'jar-section-footer';
    const footerControls = buildRegionControls();
    confirmAreas.set('footer', footerControls.confirmArea);
    confirmOpenKeys.set('footer', null);

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
      pendingColor: null,
      dataButtons,
      confirmAreas,
      confirmOpenKeys,
      panelOpen,
      panelRefs,
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

    // Initial count fetch (design review, HIGH): mandatory + uniform for
    // EVERY section build — boot-time jars and jars added later via jarsAdd
    // alike (no local "assume 0" special case; a fresh query is ~0.1ms).
    const historyPanelRef = panelRefs.get('history');
    if (historyPanelRef && historyPanelRef.countSpan) {
      fetchHistoryCount(row.id, historyPanelRef.countSpan);
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
    updateConfirmAreas(refs, row);
    // Panel open/closed state and panel DOM (incl. the History count span)
    // are NEVER touched here (module doc INVARIANT) — static labels/content
    // give this function nothing else to reconcile in the panels block.
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
  // Data controls (Leg 3, DD5; regrouped into panels + footer at Flight 2
  // Leg 2 / DD1/DD3): confirm-everything clear/wipe/delete actions.
  // ---------------------------------------------------------------------------

  // Confirm copy (verbatim — flight Acceptable Variations, operator-adjustable
  // at HAT) is deliberately NAME-FREE: this is what makes the (action, rowId)
  // pair alone a sufficient transition key for updateConfirmAreas below. If
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
  // Delete's confirm copy — byte-identical to the pre-relayout buildDeleteConfirm
  // string (grepped verbatim before this refactor; leg spec AC).
  const DELETE_COPY = 'Deletes this jar and wipes its cookies, site storage, and cache. Open tabs in this jar will close.';

  /**
   * Data-controls action table (leg spec guidance #2): one entry per confirm
   * action → { copy, run(id), okNote, failNote, silentSuccess? }. Clear-*
   * entries derive their action key, bridge call, and class list from
   * JAR_DATA_CLASSES, so a future data class needs zero new action-plumbing
   * beyond that list; copy/okNote stay literal per class (operator-facing
   * bespoke wording, not generated from the label). `delete` folds the
   * former standalone two-step confirm into this same table (design review,
   * MEDIUM-HIGH): its RUN BODY and COPY are preserved verbatim, but its
   * SUCCESS PATH stays the historic no-op (`silentSuccess: true` — see
   * buildDataConfirm) rather than adopting the generic ok-note-then-close
   * behavior, avoiding a transient flash under the documented
   * broadcast-before-resolve race (the section disappears via the next
   * jars-changed broadcast + reconcileUi instead).
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

  // Confirm-area region ids, in the order updateConfirmAreas diffs them.
  const CONFIRM_REGIONS = ['cookies', 'site-data', 'footer'];

  /**
   * Map a DATA_ACTIONS key to the region id that hosts its confirm area (leg
   * spec #3): clear-<classId> routes via panelForDataClass; wipe and delete
   * are jar-level identity actions, both routed to the section footer (DD1).
   * @param {string|null} action
   * @returns {string|null}
   */
  function regionForAction(action) {
    if (action === 'wipe' || action === 'delete') return 'footer';
    if (typeof action === 'string' && action.indexOf('clear-') === 0) {
      return panelForDataClass(action.slice('clear-'.length));
    }
    return null;
  }

  /** @param {string} id @param {string} action */
  function openDataConfirm(id, action) {
    ui = { mode: 'confirm', rowId: id, action, draft: null };
    render();
  }

  /**
   * Build the confirm block for one data action (cycle-2 AC): action-specific
   * copy, a Confirm button, Cancel, and its own confirm-LOCAL error line
   * (delete-confirm precedent — NOT the section's shared line).
   *
   * In-flight guard (cycle-2 AC (b)): Confirm disables itself AND this
   * action's trigger button (in its region's always-visible row) the instant
   * it's clicked — since the buttons stay clickable while a confirm is open,
   * leaving the trigger enabled would let a second click double-fire the same
   * request. This guard is load-bearing for `delete` too (design review): the
   * footer's delete button stays visible beside its own open confirm, exactly
   * like every other DATA_ACTIONS trigger, so it needs the same disable.
   * Disabling it also makes a "swap away and back to this action mid-flight"
   * impossible by construction (the trigger can't be clicked to reopen it),
   * which is the double-fire hole the sibling-visible design opens. The
   * trigger always re-enables on settle, success or failure, independent of
   * whether this confirm is still the one showing. Resolve/reject
   * additionally verify `ui` still points at THIS (action, rowId) before
   * mutating `ui` (closing the confirm) or writing the local error — an
   * abandoned promise from a swapped-away confirm must not close or relabel a
   * NEWER confirm the user opened instead.
   *
   * `entry.silentSuccess` (delete only, today): on success, skip BOTH
   * `setSectionStatus` and `closeTransient()` — the historic no-op success
   * path (module doc + DATA_ACTIONS comment above).
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
            if (!entry.silentSuccess) {
              setSectionStatus(refs, entry.okNote, true);
              if (stillOpen) closeTransient();
            }
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
   * Per-region confirm-area diff (leg spec #4): iterates the three regions
   * (cookies / site-data / footer) and rebuilds ONLY the one(s) whose open
   * `(action, rowId)` key actually changed — the M06 F4 DD6 focus-preserving
   * discipline extended to regions: a broadcast mid-confirm in one region
   * must not touch another region's (or its own unrelated) state. The
   * transition key is the open `(action, rowId)` pair as a STRING-OR-NULL —
   * NOT a boolean — so a same-row action SWAP into the SAME region (e.g.
   * clear-storage → clear-cache, both site-data) is itself a key change and
   * forces a rebuild; a literal boolean would wrongly treat "still open" as
   * "unchanged" and leave the OLD action's copy/handler on screen (cycle-2
   * review finding, extended to regions). Focuses the new confirm's Confirm
   * button, gated by the key actually changing, so an unrelated re-render
   * (e.g. a sibling jar's rename broadcast) never hijacks focus.
   * @param {SectionRefs} refs
   * @param {JarRow} row
   */
  function updateConfirmAreas(refs, row) {
    for (const regionId of CONFIRM_REGIONS) {
      const area = refs.confirmAreas.get(regionId);
      if (!area) continue;
      const openHere =
        ui.mode === 'confirm' &&
        ui.rowId === row.id &&
        ui.action != null &&
        DATA_ACTIONS[ui.action] != null &&
        regionForAction(ui.action) === regionId;
      const key = openHere ? ui.action + ':' + row.id : null;
      if (key === refs.confirmOpenKeys.get(regionId)) continue;
      refs.confirmOpenKeys.set(regionId, key);
      area.textContent = '';
      if (key === null) continue;
      const built = buildDataConfirm(row.id, /** @type {string} */ (ui.action), refs);
      area.appendChild(built.root);
      built.confirmBtn.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // History count (Flight 2, Leg 2 / DD6)
  // ---------------------------------------------------------------------------

  /**
   * Format the History panel's disclosure-button count suffix: "History —
   * N visits" / "History — no visits" (DD6). Pre-fetch and failure states
   * leave the bare "History" label (an empty suffix) — this function is only
   * ever called on a successful count resolution; see fetchHistoryCount.
   * @param {number} count
   * @returns {string}
   */
  function historyCountSuffix(count) {
    return count > 0 ? ` — ${count} visit${count === 1 ? '' : 's'}` : ' — no visits';
  }

  /**
   * Fetch and patch one jar's History-panel count span. These are the ONLY
   * TWO call sites for writing this span in the whole file (design review,
   * HIGH) — build-time (buildJarSection, uniform for boot-time jars AND jars
   * added later via jarsAdd) and the module-level onHistoryChanged handler
   * below. render()/updateJarSection NEVER write it (module doc INVARIANT):
   * the count isn't derivable from `row`/`state`, so a render-path write
   * would blank it on every unrelated broadcast with nothing to restore it.
   *
   * Teardown race guard (design review): `countSpan` is closure-captured by
   * the CALLER at fetch-issue time (never re-derived via `sectionMap` after
   * the await) — a write to a since-detached node (section removed by a
   * jars-changed broadcast that raced this fetch) is a harmless no-op.
   * historyCount rejecting (invoke error) is caught and leaves the neutral
   * label — this never throws into its caller.
   * @param {string} jarId
   * @param {HTMLElement} countSpan
   */
  function fetchHistoryCount(jarId, countSpan) {
    try {
      bridge.historyCount({ jarId })
        .then((result) => {
          if (result && result.ok) countSpan.textContent = historyCountSuffix(result.count);
        })
        .catch(() => {
          // Pre-fetch/failure state is the bare "History" label (edge case) —
          // leave the span untouched rather than writing an error into it.
        });
    } catch {
      // Defensive: never let a count fetch throw into a caller (build-time or
      // the onHistoryChanged handler), consistent with the file's style.
    }
  }

  /**
   * Build the read-only Burner section (DD7): header line (dot + name +
   * Default pill when flagged) + the F4 hint copy. NO name input, swatches,
   * make-default, panels, or footer — structurally driven by row.isBurner
   * (never an id === 'burner' string check in DOM code).
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
   * reordering pass is safe even mid-edit. Structurally unchanged by the
   * Flight 2 Leg 2 panel relayout (leg spec #9) — only buildJarSection/
   * updateJarSection's own bodies changed.
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

  // Escape dismisses ANY open transient state — create panel or a data/delete
  // confirm (FD ruling at design review: keyboard consistency across every
  // ui.mode). The name input's own keydown handler stopPropagation()s its
  // Escape, so this never double-fires against an in-progress name edit.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.mode !== null) closeTransient();
  });

  // ---------------------------------------------------------------------------
  // Hash deep-link (DD4): expand + scroll to a panel region named by
  // location.hash, after the FIRST successful applyState render (boot-race
  // guard, design review — sections don't exist before then). Matched by
  // EXACT id equality only (design review: 'site-data' itself contains a
  // hyphen, so splitting the hash on '-' would misparse it) — resolved via
  // getElementById + cross-checked against a live panelRefs region, never by
  // string surgery on the hash.
  // ---------------------------------------------------------------------------

  let appliedInitialHash = false;

  /**
   * Expand (never toggle-close) a panel by id, if it exists and isn't already
   * open. Used only by the hash deep-link — the click toggle handler above
   * has its own inline open/close logic.
   * @param {SectionRefs} refs
   * @param {string} panelId
   */
  function expandPanel(refs, panelId) {
    const panelRef = refs.panelRefs ? refs.panelRefs.get(panelId) : null;
    if (!panelRef || !refs.panelOpen || refs.panelOpen.get(panelId)) return;
    refs.panelOpen.set(panelId, true);
    panelRef.region.hidden = false;
    panelRef.button.setAttribute('aria-expanded', 'true');
  }

  /** Resolve location.hash to a live panel region (if any) and expand + scroll to it. */
  function tryExpandFromHash() {
    const hash = location.hash;
    if (!hash || hash.length < 2) return;
    const targetId = hash.slice(1);
    const el = document.getElementById(targetId);
    if (!el || !el.classList.contains('jar-panel-region')) return;
    for (const refs of sectionMap.values()) {
      if (refs.isBurner || !refs.panelRefs) continue;
      for (const [panelId, panelRef] of refs.panelRefs) {
        if (panelRef.region === el) {
          expandPanel(refs, panelId);
          el.scrollIntoView({ block: 'nearest' });
          return;
        }
      }
    }
  }

  // Runtime hash changes (in addition to the boot-race-guarded initial check
  // in applyState below). Acceptable to drop if it fights the scroll-spy in
  // practice (leg spec — log as a deviation if so).
  window.addEventListener('hashchange', () => {
    tryExpandFromHash();
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
    // Boot-race pin (design review): sections only exist after this first
    // successful render — running the hash check any earlier would find
    // nothing to expand.
    if (!appliedInitialHash) {
      appliedInitialHash = true;
      tryExpandFromHash();
    }
  }

  // Boot/broadcast race (leg edge case): subscribe FIRST, then boot-read, so a
  // mutation racing the one-shot boot reads is never lost — applyState wholesale-
  // replaces `state`, so whichever arrives last wins.
  const handle = bridge.onJarsChanged((payload) => {
    if (payload && Array.isArray(payload.containers)) applyState(payload);
  });

  // history-changed subscription (Flight 2, Leg 2 / DD6) — the page's first
  // history-changed consumer. Invalidation-signal semantics: the payload
  // carries only { jarId }; on receipt, re-query that jar's count (never
  // trust payload data). No-ops for a jarId with no live section (page not
  // scrolled there / already removed) or Burner (never has a history panel).
  const historyChangedHandle = bridge.onHistoryChanged((payload) => {
    if (!payload || typeof payload.jarId !== 'string') return;
    const refs = sectionMap.get(payload.jarId);
    if (!refs || refs.isBurner || !refs.panelRefs) return;
    const historyPanelRef = refs.panelRefs.get('history');
    if (!historyPanelRef || !historyPanelRef.countSpan) return;
    fetchHistoryCount(payload.jarId, historyPanelRef.countSpan);
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
    bridge.offHistoryChanged(historyChangedHandle);
    if (scrollObserver) scrollObserver.disconnect();
  }, { once: true });
})();
