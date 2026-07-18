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
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { createHistoryPanel } from './jars-history-panel.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { createCookiesPanel } from './jars-cookies-panel.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { createSiteDataPanel } from './jars-sitedata-panel.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { createJarTabs } from './jars-tabs.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { createConfirmModal } from './jars-confirm-modal.js';

/**
 * jars.js — the goldfinch://jars internal page controller.
 *
 * Flight 3 shipped a flat editable row list. Flight 4 Leg 2 reworks the DOM half
 * into a settings-style master-detail layout (DD1): a dynamic left nav + one
 * always-expanded `<section>` per jar (including a read-only Burner section,
 * DD7), with instant-apply inline rename/recolor replacing the old edit-mode
 * row (DD6). Mission 08 Flight 2 Leg 2 reworked each persistent jar's section
 * again: the data-class controls and the count moved into three collapsible
 * PANELS (History / Cookies / Other site data — DD1/DD3 of that flight),
 * default collapsed (DD4). Mission 08 Flight 6's HAT leg (H4, this leg)
 * replaces those three independently-collapsible panels with a WAI-ARIA
 * **tab strip** — one region visible at a time, History default-selected,
 * with the live History visit count rendered as a badge on the History tab
 * (supersedes the F2 collapsible ruling — operator authority, recorded in
 * the flight-log Decisions). Wipe and Delete stay OUTSIDE the tab widget, in
 * a section footer — jar-level identity actions, not data-class actions.
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
 * behavior — see DATA_ACTIONS below). Every destructive action confirms via
 * ONE page-level modal (H7, M08 Flight 6 Leg 5 — supersedes the per-region
 * inline confirms every earlier flight used), a growth-checkpoint extraction
 * living in the sibling `jars-confirm-modal.js` module (own doc comment):
 * its `update()` diffs the open `(action, rowId)` key exactly like the
 * retired per-region areas did — still gated by the ONE global `ui`
 * singleton (exclusivity unchanged:
 * opening any confirm anywhere replaces `ui` wholesale), just diffed once
 * page-wide instead of once per region. The modal is focus-trapped
 * (Confirm↔Cancel, Cancel default-focused — destructive-safe) and blocks
 * every other page control while open, so a tab switch or a second trigger
 * click can no longer race an open confirm — see jars-tabs.js's own doc
 * comment for the confirm-close-on-switch branch this retired. Every
 * render() reconciles `ui` against the fresh row set: if the row a confirm
 * was open for no longer exists (deleted from another surface), the
 * transient state collapses silently, without error.
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
 * Tabs (H4, M08 Flight 6): each persistent jar's data regions are a WAI-ARIA
 * tab widget — `role="tablist"` of three `role="tab"` buttons +
 * `role="tabpanel"` regions, in `JAR_PANELS` order, History default-selected.
 * Tab-panel ids keep the pre-existing `jar-<id>--<panel>` double-hyphen
 * scheme (unchanged — deep-link + `aria-controls` target). Selection state
 * lives in the section's `SectionRefs.activeTab` (a single panel id, default
 * `'history'`) + `SectionRefs.tabRefs` map (`{ tab, panel, countSpan? }` per
 * panel id) — diffed nowhere: render() NEVER touches `activeTab` or
 * tab/tabpanel DOM (static labels/content give it nothing to reconcile there
 * beyond `updateConfirmAreas`), so switching tabs is a pure, synchronous,
 * render-free concern. The tablist build + the local roving-tabindex keydown
 * handler (ArrowLeft/Right + Home/End; `menu-controller.js` is NOT loaded by
 * jars.html and its Up/Down + open/close/return-focus semantics don't fit a
 * persistent horizontal tablist, so it is never reused here) + the shared
 * `selectTab(refs, panelId)` function live in the sibling module
 * **`jars-tabs.js`** (growth-checkpoint extraction, the `jars-history-panel.js`
 * three-point-onboarding precedent — see that module's own doc comment).
 * `selectTab` is the SOLE tab-switch path — used by tab click, the roving
 * handler, AND jars.js's hash deep-link (`tryExpandFromHash`, below) — a
 * second inline flip anywhere would bypass the confirm guard. It reads `ui`
 * (injected via `getUi()`) → `closeTransient()` if switching AWAY from a
 * region that owns the open confirm → flips `aria-selected`/`tabindex`/
 * `hidden` on the same live nodes, and moves focus to the newly-selected tab
 * when the switch would otherwise strand focus on `<body>` (a focused
 * control in the outgoing tabpanel silently loses focus when its panel goes
 * `hidden`). This is what makes an active tab — or an open confirm inside it
 * — survive an unrelated `jars-changed`/`history-changed` broadcast. jars.js
 * itself keeps ONLY the per-tabpanel CONTENT (data-controls + confirm area,
 * and the History mount) via the `buildPanelContent` callback it hands to
 * `jarTabs.build()`.
 *
 * Tab counts (DD6, repointed to the tab strip; GENERALIZED from History-only
 * to all three panels — M10 Flight 3 HAT fix-rider A, design review cycle 1 +
 * FD revision rulings): every tab renders a live count badge
 * (`<span class="jar-tab-count">`) inside its own label, unified as
 * "<Label> (N)" (replaces History's former "— N visits"/"— no visits"
 * copy — zero renders "(0)", not a "no X" phrase; see `tabCountSuffix`).
 * **INVARIANT**: render()/updateJarSection NEVER write these spans — a
 * count isn't derivable from `row`/`state`, so a render-path write would
 * blank it on every unrelated broadcast with nothing to restore it. Each
 * panel has its OWN freshness story, all funneling through `tabCountSuffix`
 * for the actual DOM write:
 *   - **Build time** (mandatory + uniform for every section, boot-time and
 *     jarsAdd-created alike): `fetchHistoryCount`/`fetchCookiesCount`/
 *     `fetchSiteDataCount` fire unconditionally per persistent jar — this
 *     was already History's pre-existing mechanism; Cookies/Other-site-data
 *     now mirror it via the SAME `jarsCookiesList`/`jarsSiteDataList` calls
 *     their own tab-selection-gated `refresh()` already uses (`count =
 *     response.{cookies,origins}.length` — no new IPC channel, FD ruling).
 *     This is a BOUNDED ONE-SHOT per page load per jar (one `historyCount`
 *     query / one `cookies.get` / one `readdir`), distinct from a per-scroll
 *     live-probe shape that was considered and REJECTED at design review —
 *     the LIST fetches those two panels' own modules make stay gated behind
 *     tab-selection exactly as before (see those modules' own "Freshness
 *     (DD2)" doc comments).
 *   - **Broadcast re-fetch**: the module-level `onHistoryChanged` handler
 *     re-queries History's count on `{ jarId }` (invalidation-signal
 *     semantics, never trusting payload data — unchanged from DD6). The
 *     module-level `onJarDataChanged` handler re-queries ONLY the badge(s)
 *     for the classes actually reported in `payload.classes` (skip classes
 *     not in the broadcast) — AND skips a panel that is currently the
 *     section's `activeTab` (de-dup rule: that panel's own `refresh()` +
 *     its `onCountChanged` hook, below, already carries it — see
 *     `jarDataChangedHandle`).
 *   - **`onCountChanged` hook**: the Cookies/Other-site-data panel modules
 *     each take an optional `onCountChanged(n)` constructor dep, fired after
 *     EVERY successful `refresh()` paint with the fresh list length —
 *     `updateTabCount` routes it into that panel's own badge. This is what
 *     keeps an OPEN tab's badge accurate across that panel's OWN per-row
 *     deletes, which deliberately never broadcast.
 *
 * Lazy history fetch (design review): `historyPanel.onExpanded()` fires when
 * the section scrolls into view (the existing scroll-spy
 * `IntersectionObserver`, `observeSectionsIfChanged`), NOT at build time —
 * History being the default-active tab would otherwise fire a full 50-row
 * refresh for EVERY persistent jar on every page load. `selectTab` also
 * fires it on a direct switch TO the History tab (click/keyboard/hash), for
 * a jar section that's already on-screen but was showing another tab —
 * `onExpanded`'s own `if (initialFetchStarted) return;` guard is
 * source-agnostic, so both triggers are safely idempotent together.
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

  // Lucide "refresh-cw" path data (ISC license) — same vendored icon set/style
  // as ICON_DELETE above. Used for the Cookies/Other-site-data panels' manual
  // refresh trigger (M10 Flight 3 HAT fix-rider B, operator-requested:
  // icon-only, right-justified into the panel's own data-controls row — see
  // buildPanelRefreshButton below).
  /** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
  const ICON_REFRESH = [
    { tag: 'path', attrs: { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' } },
    { tag: 'path', attrs: { d: 'M3 3v5h5' } },
    { tag: 'path', attrs: { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' } },
    { tag: 'path', attrs: { d: 'M16 16h5v5' } }
  ];

  // Retention control (M10 Flight 3 HAT inline fix-rider, operator finding):
  // RELOCATED here from jars-history-panel.js's mount — the retention window
  // has governed history + cookies + site data together since M10 Flight 2's
  // generalized retention sweep, so a control that lived inside the History
  // tabpanel alone misled operators into reading it as history-only scope.
  // It now lives in the jar-section header, above the tab strip (built in
  // buildJarSection, patched in place by updateSectionRetention). Presets,
  // the non-preset "current value" option, and the instant-apply bridge call
  // are carried over UNCHANGED from the History panel's prior implementation
  // — only the DOM location and the label text ("Keep data for:", was "Keep
  // history for:") changed.
  const RETENTION_PRESETS = Object.freeze([7, 14, 30, 90, 180, 365]);

  /**
   * Ensure `select` has an option for `days`, adding a non-preset "current
   * value" option if it's missing one (DD5, carried over from the History
   * panel's prior implementation).
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

  /**
   * Read a jar's RAW store record by id — carries `retentionDays`, unlike
   * the page-model `JarRow` built by `buildJarPageModel` (the section-header
   * retention control's build/patch paths need the raw record, never the
   * page-model row — see buildJarSection/updateSectionRetention).
   * @param {string} id
   * @returns {any}
   */
  function currentRowFor(id) {
    return state.containers.find((c) => c.id === id) || null;
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
  // tab switching changes no scroll geometry (unlike the old collapsible
  // panels), so this is unaffected by the tab conversion. Reused (design
  // review) as the lazy-history-fetch trigger too (H4/M08 F6): a section
  // becoming intersecting is also "scrolled into view" for its History tab's
  // `onExpanded()` — cheaper than a second observer, and the callback
  // already visits every intersecting section on each firing.
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
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
            // Lazy history fetch (design review): fires for every
            // persistent-jar section as it scrolls into view, regardless of
            // which tab is currently active — cheap and idempotent
            // (onExpanded's own guard), and means History has already
            // fetched by the time a later switch-to-History reaches it.
            // no-ops for Burner (no historyPanel) and the create panel
            // (never in `sections`).
            const rowId = entry.target.id.slice('jar-'.length);
            sectionMap.get(rowId)?.historyPanel?.onExpanded();
          } else {
            visible.delete(entry.target.id);
          }
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
   * One region's always-visible button row (leg spec #4/#8) — reused
   * verbatim for the History panel (Flight 3, Leg 2 — zero-arg call, same as
   * every other caller), the Cookies panel, the Other-site-data panel, and
   * the section footer; no per-region singleton selectors (design review
   * verified reuse is safe). Used to build its own per-region confirm area
   * too, before H7 (M08 Flight 6 Leg 5) retired the per-region inline
   * confirms in favor of ONE page-level modal — see `jars-confirm-modal.js`.
   * The Cookies/Other-site-data `buttonRow`s also host that panel's
   * icon-only manual-refresh button (M10 Flight 3 HAT fix-rider B), appended
   * after that panel's Clear-* button(s) — see buildPanelRefreshButton.
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
   * Build the icon-only manual-refresh trigger for the Cookies/Other-site-data
   * panels (M10 Flight 3 HAT fix-rider B, operator-requested — replaces the
   * former full-text "Refresh" button each panel module used to build inside
   * its own mount). Built and appended HERE, in jars.js, rather than inside
   * the panel module, so it can land in the SAME `.jar-data-controls-buttons`
   * flex row as that panel's Clear-* button(s) — "top row of the panel,
   * right-aligned, no new line" (rider spec) — without the panel module
   * reaching outside its own mount (DD7 boundary unchanged: jars.js already
   * owns and appends into `buttonRow`; the panel module gains no new
   * DOM-writing responsibility, only a plain `refresh()` trigger method this
   * button's click calls — see buildJarSection's call sites below). Accessible
   * name is the literal, panel-agnostic "Refresh" (rider spec, verbatim) —
   * same convention for both panels, consistency over per-panel specificity.
   * `.jar-datalist-refresh`'s `margin-left: auto` (jars.css) does the actual
   * right-justify; this button must be APPENDED AFTER the Clear-* button(s)
   * in its row (see buildJarSection) so DOM order stays [Clear-*, Refresh]
   * within the pushed-right cluster.
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

  // jarTabs (H4, M08 Flight 6, growth-checkpoint extraction — jars-tabs.js's
  // own doc comment): the ONE instance shared by every persistent jar's
  // section build below. Leg 5 retired the confirm-close-on-switch branch
  // (a page-level modal now blocks tab-strip interaction while a confirm is
  // open, so a switch can never race an open confirm) — `createJarTabs` no
  // longer takes the ui-accessor/close/region-routing deps it used to.
  const jarTabs = createJarTabs({ panels: JAR_PANELS });

  /**
   * Build the always-expanded section for a persistent (non-Burner) jar:
   * header (dot + name + a header-slot occupied by EITHER the Default pill OR
   * the "Make default" text button — HAT step-1 finding F1), inline name
   * input + swatch grid (instant apply, DD6), a WAI-ARIA tab widget (History /
   * Cookies / Other site data — H4/M08 Flight 6, History default-selected;
   * built by `jarTabs.build()`), and a footer hosting Wipe + Delete
   * (jar-level identity actions, outside the tab widget — DD1). "Make
   * default" stays a text button (F3 HAT ruling).
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

    // Retention control (M10 Flight 3 HAT inline fix-rider — module-scope doc
    // comment above RETENTION_PRESETS): right-aligned in the section header
    // row (margin-left: auto, jars.css), above the tab strip, so it reads as
    // governing the whole jar's data — not just the History tabpanel it used
    // to live inside. Explicit for/id association (not the History panel's
    // former implicit label-wraps-select shape) per the section's other
    // form controls (see nameLabel's own `for`-free wrap vs this one — a11y
    // review chose explicit association here since the control also needs a
    // stable id for the section-scoped uniqueness `jar-<id>-retention`
    // already guarantees). The change listener is wired below, after `refs`
    // is assigned (same forward-declare pattern as nameInput's listeners).
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

    // -------------------------------------------------------------------
    // Tab widget (H4, M08 Flight 6): the tablist build, roving-tabindex
    // keydown handler, and shared selectTab() all live in jars-tabs.js
    // (growth-checkpoint extraction — that module's own doc comment). This
    // page keeps only each tabpanel's CONTENT: the standard jars.js-owned
    // data controls (Clear-<class> button(s) — plus, for Cookies/
    // Other-site-data, the manual-refresh icon button, M10 Flight 3 HAT
    // fix-rider B — via `buildRegionControls()`) for every panel, plus
    // History's SECOND child — the module-owned mount (DD7 DOM contract —
    // the panel has exactly two children; jars.js never writes inside the
    // mount). Each button's confirm now opens the ONE page-level modal (H7,
    // Leg 5) instead of an inline per-region area.

    /** @type {Map<string, HTMLButtonElement>} */
    const dataButtons = new Map();
    // regionId ('cookies' | 'site-data') -> its tabpanel's button row, so the
    // JAR_DATA_CLASSES loop below can route each clear-* button in (leg spec #3).
    /** @type {Map<string, HTMLElement>} */
    const panelButtonRows = new Map();
    // regionId ('cookies' | 'site-data') -> its manual-refresh icon button
    // (M10 Flight 3 HAT fix-rider B) — built in buildPanelContent below,
    // appended into panelButtonRows' matching row AFTER the Clear-* loop so
    // DOM order stays [Clear-*, Refresh] (see buildPanelRefreshButton's doc
    // comment). History has no entry — it has no manual refresh trigger.
    /** @type {Map<string, HTMLButtonElement>} */
    const panelRefreshButtons = new Map();

    // Forward-declared: `buildPanelContent`'s History branch (below) and its
    // module instance both close over `refs`, which is only assigned once
    // the section is otherwise fully built (see the SectionRefs literal
    // below). Safe — neither closure is ever invoked until after
    // buildJarSection returns, by which point `refs` is set.
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
          // H9 (M08 F6 Leg 7): on a user-initiated pager page change, scroll
          // this jar's own section back into view so the tab strip lands at
          // the top — same closes-over-`refs` pattern as `buildPanelContent`
          // above (refs is only assigned once the section is fully built,
          // but this callback is never invoked until after that point).
          // `block: 'start'` (not tryExpandFromHash's 'nearest') puts the
          // tabs at the top per the leg's ruling; reduced-motion is handled
          // by the existing page-wide CSS gate (jars.css's `scroll-behavior:
          // smooth` only under `prefers-reduced-motion: no-preference`), so
          // no JS-side media-query check is needed here.
          onPageChange: () => refs.root.scrollIntoView({ block: 'start' })
        });
      } else if (panelId === 'cookies') {
        // M10 Flight 2 Leg 2 / flight DD2, DD7: module-owned mount, same
        // two-child DOM contract as History's (controls.root above + this
        // mount). No onExpanded/onPageChange-style callbacks — the Cookies
        // panel's ONLY freshness triggers are the tab-selection
        // activationHooks entry (below), its own per-row mutations, and the
        // jar-data-changed broadcast (module-level subscription, below).
        const cookiesMount = document.createElement('div');
        cookiesMount.className = 'jar-cookies-mount';
        panelEl.appendChild(cookiesMount);

        cookiesPanel = createCookiesPanel({
          bridge,
          jarId: row.id,
          mountEl: cookiesMount,
          onError: (message) => setSectionStatus(refs, message, false),
          // M10 Flight 3 HAT fix-rider A: route this panel's own post-refresh
          // list length into its own tab badge (updateTabCount, below).
          onCountChanged: (count) => updateTabCount(refs, 'cookies', count)
        });
        // M10 Flight 3 HAT fix-rider B: the manual-refresh icon lives in
        // jars.js's OWN controls row (buildPanelRefreshButton's doc comment),
        // not this module's mount — built here, appended after the Clear-*
        // loop below.
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

    // Activation hooks (design review, HIGH — jars-tabs.js's generalized,
    // data-driven `selectTab` dispatch; see that module's own doc comment).
    // History's hook preserves the pre-existing onExpanded call (idempotent
    // — also fired independently by the scroll-into-view
    // IntersectionObserver, observeSectionsIfChanged); Cookies/Other-site-data
    // have no section-visibility trigger at all (DD2) — tab-selection is
    // their ONLY activation path, alongside their own mutations and the
    // module-level jar-data-changed subscription below. Closures read the
    // outer `historyPanel`/`cookiesPanel`/`siteDataPanel` lets at CALL time
    // (never invoked before buildPanelContent has run for that panel, since
    // History is the only default-selected tab and the other two are only
    // ever reached via an explicit selectTab call after build() returns).
    //
    // DD2's "query trigger gates on TAB-SELECTION" ruling above governs the
    // Cookies/Other-site-data panels' LIST fetch ONLY (their `refresh()`,
    // dispatched via `onActivated` here) — it is UNCHANGED by M10 Flight 3
    // HAT fix-rider A. That rider's tab-BADGE count pass
    // (fetchCookiesCount/fetchSiteDataCount, below) is a separate, bounded
    // one-shot query fired at SECTION BUILD TIME instead (one `cookies.get` /
    // one `readdir` per persistent jar, once per page load) — mirroring
    // History's own pre-existing fetchHistoryCount mechanism, which already
    // fired unconditionally at build time before this rider (FD ruling,
    // design review cycle 1: a per-scroll live-probe shape for the count pass
    // was considered and REJECTED in favor of this uniform build-time trigger
    // — see "Initial count fetch" below).
    /** @type {Map<string, () => void>} */
    const activationHooks = new Map([
      ['history', () => historyPanel?.onExpanded()],
      ['cookies', () => cookiesPanel?.onActivated()],
      ['site-data', () => siteDataPanel?.onActivated()]
    ]);

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

    // Manual-refresh icon buttons (M10 Flight 3 HAT fix-rider B): appended
    // AFTER the Clear-* loop above so DOM order stays [Clear-*, Refresh]
    // inside each panel's SAME buttonRow — `.jar-datalist-refresh`'s
    // `margin-left: auto` (jars.css) right-justifies the pushed-right
    // cluster, keeping Clear-* left-aligned within it.
    for (const [panelId, refreshBtn] of panelRefreshButtons) {
      const buttonRow = panelButtonRows.get(panelId);
      if (buttonRow) buttonRow.appendChild(refreshBtn);
    }

    // Footer (DD1): Wipe ("Clear identity") + Delete are jar-LEVEL identity
    // actions, outside all panels — rendered side by side (leg spec #3),
    // sharing the same page-level confirm modal (H7, Leg 5) as every other
    // trigger. The delete button MUST be registered in `dataButtons` (design
    // review): it now stays visible beside the open modal, so the
    // trigger-disable guard in jars-confirm-modal.js's buildContent is
    // load-bearing against double-fire for delete, exactly as it already is
    // for wipe/clear-*.
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

    // Retention control change handler (relocated — module-scope doc comment
    // above RETENTION_PRESETS): instant-apply, reverted on failure. Wired
    // here (after `refs` is assigned) rather than at the header-build site
    // above, mirroring nameInput's own listeners just below — the handler
    // only ever runs after an operator interaction, well after buildJarSection
    // has returned and assigned `refs`.
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

    // Initial count fetch (design review, HIGH; GENERALIZED to all three
    // panels — M10 Flight 3 HAT fix-rider A, FD revision ruling): mandatory +
    // uniform for EVERY section build, EVERY panel — boot-time jars and jars
    // added later via jarsAdd alike (no local "assume 0" special case; each
    // fetch is a single bounded query, not a live probe — see the
    // activationHooks comment above for the FD ruling this generalizes).
    // History's fetchHistoryCount already fired unconditionally at build time
    // before this rider; fetchCookiesCount/fetchSiteDataCount now mirror it
    // via the SAME jarsCookiesList/jarsSiteDataList calls those panels' own
    // tab-selection-gated refresh() uses (no new IPC channel).
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

    // Uniform focus rule: a focused name input's value is never overwritten by
    // a render pass — it syncs on blur (via commitOrRevertName) instead. That
    // deferred sync only actually runs the display-catchup branch (not a
    // commit) when the input is clean (nameDirty is false) — see
    // commitOrRevertName.
    if (document.activeElement !== refs.nameInput) {
      refs.nameInput.value = row.name;
    }
    refs.nameInput.setAttribute('aria-label', `Name for ${row.name}`);
    if (refs.retentionSelect) refs.retentionSelect.setAttribute('aria-label', `Keep data for (${row.name})`);

    updateSwatchGrid(refs, row);
    // Active-tab selection and tab/tabpanel DOM (incl. the History count
    // badge) are NEVER touched here (module doc INVARIANT) — static
    // labels/content give this function nothing else to reconcile in the
    // tab widget. The confirm modal (H7, Leg 5) is reconciled ONCE
    // page-wide, in render() via confirmModal.update() — not per section.
    updateSectionRetention(refs, row.id);
  }

  /**
   * Patch-in-place the section-level retention select from the raw store
   * record (never the page-model `row`, which lacks `retentionDays` —
   * `currentRowFor`'s own doc comment). Relocated from the History panel's
   * former `onJarsRow` hook (module-scope doc comment above
   * RETENTION_PRESETS) — same guard: never overwrite a focused select.
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
  // Keyed by the data-CLASS id (`cls.id`), NOT the action id (design review,
  // HIGH — DATA_ACTIONS sources copy via CLEAR_COPY[cls.id]; a 'clear-history'
  // key here would render undefined confirm copy). This mistake nearly
  // shipped — double-check any future entry is keyed by class id.
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
  // H6 (M08 Flight 6 HAT, flight-log Decisions): wiping a jar now CLOSES its
  // open web tabs instead of reloading them (renderer.js onJarWiped) — the
  // reload was re-recording a fresh visit in the just-cleared history. The
  // copy must warn tabs will close, not reload (design review — was
  // "reload").
  const WIPE_COPY =
    "Wipes this jar's cookies, site storage, and cache, and rerolls its fingerprint. Open tabs in this jar will close.";
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
   * jars-confirm-modal.js's buildContent) rather than adopting the generic
   * ok-note-then-close behavior, avoiding a transient flash under the documented
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

  // Per-action modal title table (design review — the modal's confirm body
  // has no heading of its own; H7's modal needs one for aria-labelledby).
  // Clear-* titles are derived from JAR_DATA_CLASSES, same as DATA_ACTIONS'
  // own action-plumbing above — a future data class needs no new title
  // wiring.
  /** @type {{ [action: string]: string }} */
  const CONFIRM_TITLE = {};
  for (const cls of JAR_DATA_CLASSES) {
    CONFIRM_TITLE['clear-' + cls.id] = `Clear ${cls.label.toLowerCase()}?`;
  }
  CONFIRM_TITLE.wipe = 'Clear identity?';
  CONFIRM_TITLE.delete = 'Delete jar?';

  // confirmModal (H7, M08 Flight 6 Leg 5, growth-checkpoint extraction —
  // jars-confirm-modal.js's own doc comment): the ONE page-level confirm
  // modal instance, replacing the per-region inline confirms every earlier
  // flight used. `getSectionRefs` and `setSectionStatus`/`closeTransient`
  // are the exact same lookups/functions every other confirm path in this
  // file already uses.
  const confirmModal = createConfirmModal({
    dataActions: DATA_ACTIONS,
    titles: CONFIRM_TITLE,
    getUi: () => ui,
    closeTransient,
    getSectionRefs: (rowId) => sectionMap.get(rowId),
    setSectionStatus,
    fallbackFocusEl: newBtn
  });

  /** @param {string} id @param {string} action */
  function openDataConfirm(id, action) {
    // Capture the trigger for focus-restore on close (H7, design review) —
    // MUST happen before `ui` is reassigned (see jars-confirm-modal.js's own
    // doc comment on captureTrigger's timing).
    confirmModal.captureTrigger();
    ui = { mode: 'confirm', rowId: id, action, draft: null };
    render();
  }

  // ---------------------------------------------------------------------------
  // Tab counts (Flight 2, Leg 2 / DD6; GENERALIZED from History-only to all
  // three panels — M10 Flight 3 HAT fix-rider A, design review cycle 1 + FD
  // revision rulings)
  // ---------------------------------------------------------------------------

  /**
   * Format a tab's count-badge suffix: unified " (N)" for ALL THREE panels
   * (operator-requested copy change, fix-rider A — REPLACES History's former
   * "— N visits" / "— no visits" wording; zero renders "(0)", never a "no X"
   * phrase). Concatenated after the tab's own static label text node, this
   * reads "<Label> (N)" — e.g. "History (154)", "Cookies (32)", "Other site
   * data (56)". Pre-fetch and failure states leave the bare label (an empty
   * suffix) — this function is only ever called on a successful count
   * resolution; see fetchHistoryCount/fetchCookiesCount/fetchSiteDataCount.
   * @param {number} count
   * @returns {string}
   */
  function tabCountSuffix(count) {
    return ` (${count})`;
  }

  /**
   * Fetch and patch one jar's History-panel count span. Two of the several
   * call sites that write ANY tab's count span in this file (design review,
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
          if (result && result.ok) countSpan.textContent = tabCountSuffix(result.count);
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
   * Fetch and patch one jar's Cookies-panel count span (M10 Flight 3 HAT
   * fix-rider A) — the SAME `jarsCookiesList` call the Cookies panel's own
   * LIST view uses (no new IPC channel, FD ruling), `count =
   * cookies.length`. Mirrors fetchHistoryCount's shape exactly, including the
   * teardown-race guard (countSpan closure-captured at fetch-issue time) and
   * the never-throws-into-caller discipline.
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
          // Pre-fetch/failure state is the bare "Cookies" label — leave the
          // span untouched rather than writing an error into it.
        });
    } catch {
      // Defensive: never let a count fetch throw into its caller.
    }
  }

  /**
   * Fetch and patch one jar's Other-site-data-panel count span (M10 Flight 3
   * HAT fix-rider A) — the SAME `jarsSiteDataList` call that panel's own LIST
   * view uses, `count = origins.length`. Mirrors fetchHistoryCount/
   * fetchCookiesCount's shape exactly.
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
          // Pre-fetch/failure state is the bare "Other site data" label —
          // leave the span untouched rather than writing an error into it.
        });
    } catch {
      // Defensive: never let a count fetch throw into its caller.
    }
  }

  /**
   * Route a panel's fresh list length straight into its own tab's count
   * badge, bypassing a fetch entirely (M10 Flight 3 HAT fix-rider A) — the
   * `onCountChanged` hook the Cookies/Other-site-data panel modules fire
   * after every successful `refresh()` paint. This is what keeps an OPEN
   * tab's badge accurate across that panel's own per-row deletes, which
   * deliberately never broadcast (see those modules' own doc comments). A
   * no-op if the section/tabRefs/countSpan aren't (yet, or any longer)
   * available — same teardown-tolerant shape as the fetch* functions above.
   * @param {SectionRefs} refs
   * @param {string} panelId
   * @param {number} count
   */
  function updateTabCount(refs, panelId, count) {
    const tabRef = refs.tabRefs?.get(panelId);
    if (tabRef && tabRef.countSpan) tabRef.countSpan.textContent = tabCountSuffix(count);
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
  // Hash deep-link (DD4, repointed to tabs — design review, HIGH): select +
  // scroll to the tab named by location.hash, after the FIRST successful
  // applyState render (boot-race guard, design review — sections don't exist
  // before then). Matched by EXACT id equality only (design review:
  // 'site-data' itself contains a hyphen, so splitting the hash on '-' would
  // misparse it) — resolved via getElementById + cross-checked against a
  // live tabRefs panel, never by string surgery on the hash. Routes through
  // the SAME shared `selectTab()` as click and the roving keydown handler —
  // NOT an inline flip — so it carries the confirm-close guard and the
  // never-strand-focus-on-body rule for free.
  // ---------------------------------------------------------------------------

  let appliedInitialHash = false;

  /** Resolve location.hash to a live tabpanel (if any) and select + scroll to its section. */
  function tryExpandFromHash() {
    const hash = location.hash;
    if (!hash || hash.length < 2) return;
    const targetId = hash.slice(1);
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
    // Confirm modal (H7, Leg 5) reconciled AFTER renderSections — see
    // jars-confirm-modal.js's update() doc comment for why the ordering
    // matters.
    confirmModal.update();
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
    if (!refs || refs.isBurner) return;
    // In addition to the count refresh below (Flight 2's existing wiring),
    // the History module re-runs its own current view's top page — a no-op
    // if the panel was never expanded (leg spec #5).
    refs.historyPanel?.onHistoryChanged();
    if (!refs.tabRefs) return;
    const historyTabRef = refs.tabRefs.get('history');
    if (!historyTabRef || !historyTabRef.countSpan) return;
    fetchHistoryCount(payload.jarId, historyTabRef.countSpan);
  });

  // jar-data-changed subscription (M10 Flight 2, Leg 2 / flight DD10) — the
  // Cookies + Other-site-data panels' invalidation-signal handler, mirroring
  // history-changed's shape (payload carries only { jarId, classes }; never
  // trust payload data beyond routing). BOTH panels' LIST view re-queries on
  // it, unconditionally of which classes fired it (leg spec AC), same as they
  // both re-query directly after their OWN mutations regardless of the
  // broadcast. No-op for a jarId with no live section or Burner (never has
  // either panel).
  //
  // Tab-badge counts (M10 Flight 3 HAT fix-rider A) get a NARROWER re-fetch,
  // layered on top of the LIST re-query above: scoped to the classes the
  // broadcast actually reports (skip classes not in the broadcast — `cache`
  // alone, e.g., never touches either panel's badge) via panelForDataClass,
  // AND skipping a panel that is currently the section's `activeTab`
  // (de-dup rule) — that panel's own `refresh()` call just above already
  // fires its `onCountChanged` hook with the fresh list length
  // (updateTabCount), so a second independent count fetch here would be
  // redundant, racing work.
  const jarDataChangedHandle = bridge.onJarDataChanged((payload) => {
    if (!payload || typeof payload.jarId !== 'string') return;
    const refs = sectionMap.get(payload.jarId);
    if (!refs || refs.isBurner) return;
    refs.cookiesPanel?.onJarDataChanged();
    refs.siteDataPanel?.onJarDataChanged();

    if (!refs.tabRefs) return;
    const classes = Array.isArray(payload.classes) ? payload.classes : [];
    /** @type {Set<string>} */
    const touchedPanels = new Set();
    for (const classId of classes) {
      const panelId = panelForDataClass(classId);
      if (panelId) touchedPanels.add(panelId);
    }
    for (const panelId of touchedPanels) {
      if (panelId === 'history') continue; // history's badge has its own onHistoryChanged path above
      if (refs.activeTab === panelId) continue; // de-dup: the active panel's own refresh+hook carries it
      const tabRef = refs.tabRefs.get(panelId);
      if (!tabRef || !tabRef.countSpan) continue;
      if (panelId === 'cookies') fetchCookiesCount(payload.jarId, tabRef.countSpan);
      else if (panelId === 'site-data') fetchSiteDataCount(payload.jarId, tabRef.countSpan);
    }
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
    bridge.offJarDataChanged(jarDataChangedHandle);
    if (scrollObserver) scrollObserver.disconnect();
  }, { once: true });
})();
