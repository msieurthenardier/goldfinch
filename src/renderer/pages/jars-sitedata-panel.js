// @ts-check

/**
 * jars-sitedata-panel.js — the Other-site-data panel's content module (M10
 * Flight 2 Leg 2 / flight DD3 VERDICT, DD7). Cloned from
 * `jars-cookies-panel.js`'s shape (itself cloned from
 * `jars-history-panel.js`): jars.js builds one instance per persistent jar's
 * Other-site-data region and delegates to it; this module owns everything
 * INSIDE the mount `<div class="jar-sitedata-mount">` it is handed — the
 * manual refresh affordance, the known-gap note, the origin list (two-tier
 * badges), and per-origin delete.
 *
 * DOM contract (mirrors DD7's History contract): the region has exactly two
 * children — jars.js's own `.jar-data-controls` block (Clear-storage button
 * + confirm) and this module's mount.
 *
 * Freshness (DD2, same discipline as the Cookies panel): queries fresh on
 * every ACTIVATION (`onActivated`, no "first time only" guard — see
 * `jars-cookies-panel.js`'s doc comment for the full rationale, which
 * applies identically here), immediately re-queries after its own
 * per-origin delete, and re-queries on `onJarDataChanged` (DD10).
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

const KNOWN_GAP_NOTE =
  "This list may be incomplete: local storage isn't visible here, and origins never visited in this jar won't " +
  "appear even if they hold third-party data. Clearing a “Visited” origin with no actual storage " +
  'succeeds silently (it acts on storage, not history).';

/**
 * @param {{
 *   bridge: GoldfinchInternalBridge,
 *   jarId: string,
 *   mountEl: HTMLElement,
 *   onError: (message: string) => void
 * }} deps
 * @returns {{ onActivated: () => void, onJarDataChanged: () => void, destroy: () => void }}
 */
export function createSiteDataPanel({ bridge, jarId, mountEl, onError }) {
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'jar-btn jar-datalist-refresh';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.setAttribute('aria-label', 'Refresh site data');
  mountEl.appendChild(refreshBtn);

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
      })
      .catch(() => {
        if (token !== viewGen) return;
        onError('Could not load site data');
      });
  }

  refreshBtn.addEventListener('click', () => refresh());

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

  return { onActivated, onJarDataChanged, destroy };
}
