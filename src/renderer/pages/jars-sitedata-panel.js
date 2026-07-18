// @ts-check

/**
 * jars-sitedata-panel.js — the Other-site-data panel's content module (M10
 * Flight 2 Leg 2 / flight DD3 VERDICT, DD7). Cloned from
 * `jars-cookies-panel.js`'s shape (itself cloned from
 * `jars-history-panel.js`): jars.js builds one instance per persistent jar's
 * Other-site-data region and delegates to it; this module owns everything
 * INSIDE the mount `<div class="jar-sitedata-mount">` it is handed — the
 * known-gap note, the origin list (two-tier badges), and per-origin delete.
 *
 * DOM contract (mirrors DD7's History contract): the region has exactly two
 * children — jars.js's own `.jar-data-controls` block (Clear-storage button
 * + confirm) and this module's mount.
 *
 * Manual refresh trigger (M10 Flight 3 HAT fix-rider B, operator-requested):
 * same relocation as `jars-cookies-panel.js` — the refresh AFFORDANCE (icon,
 * right-justified into jars.js's own `.jar-data-controls-buttons` row
 * alongside the Clear-storage/Clear-cache buttons) now lives in jars.js; this
 * module keeps only the `refresh()` query logic, exposed as a returned hook.
 *
 * Tab-badge count (M10 Flight 3 HAT fix-rider A, design review cycle 1 + FD
 * revision rulings): same shape as `jars-cookies-panel.js` — an optional
 * `onCountChanged(n)` constructor dep fires after every successful
 * `refresh()` paint with the fresh origin-list length, routed by jars.js into
 * this panel's own tab badge (keeps an OPEN tab's badge accurate across this
 * panel's own per-origin deletes, which deliberately never broadcast).
 *
 * Freshness (DD2, same discipline as the Cookies panel): queries fresh on
 * every ACTIVATION (`onActivated`, no "first time only" guard — see
 * `jars-cookies-panel.js`'s doc comment for the full rationale, which
 * applies identically here), immediately re-queries after its own
 * per-origin delete, and re-queries on `onJarDataChanged` (DD10). The
 * tab-strip's BUILD-TIME count pass (jars.js's fetchSiteDataCount) is a
 * SEPARATE, bounded one-shot query per page load (one `readdir` per
 * persistent jar) — not a second live-probe trigger on this panel's own
 * activation/broadcast gating; see `jars-cookies-panel.js`'s Freshness
 * paragraph for the design-review rationale (a per-scroll live-probe shape
 * was considered and REJECTED), which applies identically here.
 *
 * Two-tier composite (DD3 VERDICT): each origin carries a `tier` —
 * `'stored'` (IndexedDB-confirmed) or `'visited'` (history-derived,
 * "storage unconfirmed"). NO usage/quota figure (verified unavailable via
 * Electron's public API — mission-design Architect premise, reconfirmed at
 * Spike B). The panel states its own known gap explicitly (localStorage-only
 * and never-visited third-party-only origins are invisible to both
 * mechanisms; deleting a `visited`-tier origin with no actual storage is a
 * silent no-op — the delete acts on storage, not history) rather than
 * presenting the list as complete.
 *
 * Views + staleness: the same monotonic `viewGen` guard as the Cookies panel
 * (leg spec requirement, `jars-history-panel.js` precedent).
 *
 * No-confirm per-row delete (design review, verified convention) — same as
 * every other per-row delete on this page.
 *
 * No unit suite for this module (house practice for page controllers) —
 * static nets only; live behavior verification is this leg's smoke check +
 * a future behavior-test gate.
 *
 * Explainer + badge tooltips (M10 Flight 3 HAT fix-rider C, operator
 * comprehension finding — look-and-feel fix, inline): the operator found
 * the panel unexplained during the HAT walkthrough. Added a one-line
 * plain-language explainer painted first in the mount (EXPLAINER_NOTE,
 * `.textContent` only) plus supplementary `title` tooltips on the two badge
 * types (TIER_TOOLTIP) — the badge's own text stays the accessible content,
 * tooltips are additive. KNOWN_GAP_NOTE tightened to drop the now-redundant
 * "(it acts on storage, not history)" aside without losing any of its three
 * honesty clauses. Deeper "show what a site actually stores" capability is
 * out of scope here — captured as a future-mission seed in BACKLOG.md
 * ("Site-data inspector").
 */

// ---------------------------------------------------------------------------
// Duplicated trash-2 icon (H3 / jars-history-panel.js precedent).
// ---------------------------------------------------------------------------

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

const TIER_LABEL = Object.freeze({
  stored: 'Has stored data',
  visited: 'Visited — storage unconfirmed'
});

// M10 Flight 3 HAT fix-rider C (operator comprehension finding, inline
// look-and-feel fix): tooltips on the two badge types, supplementary only —
// the badge's own `.textContent` (TIER_LABEL, above) remains the accessible
// content; these are plain `title` attributes, not aria-label overrides.
const TIER_TOOLTIP = Object.freeze({
  stored: 'This site has a database stored on your device in this jar.',
  visited:
    "You visited this site in this jar; it may hold storage that can't be " +
    'listed. Delete still clears whatever is there.'
});

// M10 Flight 3 HAT fix-rider C: one-line plain-language explainer, painted
// FIRST in the mount (above the known-gap note) — the operator found the
// panel unexplained during the HAT walkthrough. Deliberately doesn't claim
// localStorage coverage (KNOWN_GAP_NOTE below states it's invisible here).
const EXPLAINER_NOTE =
  'Sites that keep data on your device in this jar — like databases or ' +
  "cached files — beyond cookies. Delete removes a site's stored data; " +
  'your history is unaffected.';

// Tightened for fix-rider C: the "(it acts on storage, not history)" aside
// is now redundant with EXPLAINER_NOTE's "your history is unaffected" and
// the `visited` tooltip's "Delete still clears whatever is there" — dropped
// rather than duplicated. The three honesty clauses stay: localStorage is
// invisible here, never-visited origins are absent, and a `visited`-tier
// delete can succeed silently with nothing actually there.
const KNOWN_GAP_NOTE =
  "This list may be incomplete: local storage isn't visible here, and origins never visited in this jar won't " +
  "appear even if they hold third-party data. Clearing a “Visited” origin with no actual storage " +
  'still succeeds silently.';

/**
 * @param {{
 *   bridge: GoldfinchInternalBridge,
 *   jarId: string,
 *   mountEl: HTMLElement,
 *   onError: (message: string) => void,
 *   onCountChanged?: (count: number) => void
 * }} deps
 * @returns {{ onActivated: () => void, onJarDataChanged: () => void, refresh: () => void, destroy: () => void }}
 */
export function createSiteDataPanel({ bridge, jarId, mountEl, onError, onCountChanged }) {
  // Manual-refresh BUTTON lives in jars.js now (M10 Flight 3 HAT fix-rider
  // B — module doc comment) — this module keeps only the refresh() QUERY
  // logic, exposed below as a returned hook for jars.js's button to call.
  const explainerNote = document.createElement('p');
  explainerNote.className = 'jar-datalist-explainer-note';
  explainerNote.textContent = EXPLAINER_NOTE;
  mountEl.appendChild(explainerNote);

  const gapNote = document.createElement('p');
  gapNote.className = 'jar-datalist-gap-note';
  gapNote.textContent = KNOWN_GAP_NOTE;
  mountEl.appendChild(gapNote);

  const listEl = document.createElement('ul');
  listEl.className = 'jar-datalist';
  listEl.setAttribute('role', 'list');
  mountEl.appendChild(listEl);

  const statusLine = document.createElement('p');
  statusLine.className = 'jar-datalist-status';
  statusLine.setAttribute('aria-live', 'polite');
  mountEl.appendChild(statusLine);

  let viewGen = 0;
  let hasActivatedOnce = false;

  /**
   * @param {{ origin: string, tier: ('stored'|'visited') }} row
   * @returns {HTMLLIElement}
   */
  function buildRow(row) {
    const li = document.createElement('li');
    li.className = 'jar-datalist-row';

    const textWrap = document.createElement('div');
    textWrap.className = 'jar-datalist-row-text';

    const primaryWrap = document.createElement('p');
    primaryWrap.className = 'jar-datalist-row-primary';
    primaryWrap.textContent = row.origin;

    const badge = document.createElement('span');
    badge.className = `jar-datalist-badge jar-datalist-badge-${row.tier}`;
    badge.textContent = TIER_LABEL[row.tier] || row.tier;
    const tooltip = TIER_TOOLTIP[row.tier];
    if (tooltip) badge.title = tooltip;
    primaryWrap.appendChild(badge);

    textWrap.appendChild(primaryWrap);
    li.appendChild(textWrap);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'jar-datalist-row-delete';
    deleteBtn.appendChild(buildIcon(ICON_DELETE));
    deleteBtn.setAttribute('aria-label', `Clear site data: ${row.origin}`);
    deleteBtn.addEventListener('click', () => {
      bridge
        .jarsSiteDataRemoveOrigin({ id: jarId, origin: row.origin })
        .then((result) => {
          if (!result || !result.ok) {
            onError('Could not clear site data');
            return;
          }
          // No-confirm, immediate delete — re-query directly (DD10's
          // "own-panel refresh still direct" ruling), never waiting on the
          // jar-data-changed broadcast for its own mutation.
          refresh();
        })
        .catch(() => onError('Could not clear site data'));
    });
    li.appendChild(deleteBtn);

    return li;
  }

  /** Query + paint, guarded by the monotonic view-generation token. */
  function refresh() {
    viewGen += 1;
    const token = viewGen;
    bridge
      .jarsSiteDataList({ id: jarId })
      .then((result) => {
        if (token !== viewGen) return; // stale — a newer query superseded this one
        if (!result || !result.ok) {
          onError('Could not load site data');
          return;
        }
        const rows = Array.isArray(result.origins) ? result.origins : [];
        listEl.textContent = '';
        for (const row of rows) listEl.appendChild(buildRow(row));
        statusLine.textContent = rows.length === 0 ? 'No known storage for this jar' : '';
        // M10 Flight 3 HAT fix-rider A: report the fresh count to jars.js's
        // tab badge after EVERY successful paint — see
        // jars-cookies-panel.js's identical note for the full rationale.
        onCountChanged?.(rows.length);
      })
      .catch(() => {
        if (token !== viewGen) return;
        onError('Could not load site data');
      });
  }

  function onActivated() {
    // No "first time only" guard — see jars-cookies-panel.js's doc comment
    // (DD2: no live storage-change subscription, so staleness is bounded
    // only by panel-open lifetime).
    hasActivatedOnce = true;
    refresh();
  }

  function onJarDataChanged() {
    if (!hasActivatedOnce) return;
    refresh();
  }

  function destroy() {
    viewGen += 1; // kills any in-flight late paint
    mountEl.textContent = '';
  }

  return { onActivated, onJarDataChanged, refresh, destroy };
}
