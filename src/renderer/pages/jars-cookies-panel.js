// @ts-check

/**
 * jars-cookies-panel.js — the Cookies panel's content module (M10 Flight 2
 * Leg 2 / flight DD2, DD7). Cloned from `jars-history-panel.js`'s shape:
 * jars.js builds one instance per persistent jar's Cookies region and
 * delegates to it; this module owns everything INSIDE the mount
 * `<div class="jar-cookies-mount">` it is handed — the manual refresh
 * affordance, the cookie list, and per-row delete. It never reaches jars.js's
 * page-level transient/reconcile state or its per-section DOM registry, and
 * never touches anything outside its own `mountEl`.
 *
 * DOM contract (mirrors DD7's History contract): the Cookies region has
 * exactly two children — jars.js's own `.jar-data-controls` block
 * (Clear-cookies button + confirm) and this module's mount. jars.js never
 * writes inside the mount; this module never touches the controls block or
 * the region node itself.
 *
 * Freshness (DD2): NO live `cookies.on('changed')` subscription reaches the
 * UI — the panel queries fresh on every ACTIVATION (tab-selection, dispatched
 * through jars-tabs.js's generalized `activationHooks` map via
 * `onActivated`, NOT the section-visibility `onExpanded` trigger the History
 * panel uses), immediately re-queries after its own per-cookie delete
 * (DD10's "own-panel refresh still direct" ruling — never waits on the
 * jar-data-changed broadcast for its own mutation), and re-queries on
 * `onJarDataChanged` (DD10, fired by Clear-cookies/Clear-storage/Wipe on ANY
 * surface). Unlike History's `onExpanded`, `onActivated` carries NO "first
 * time only" guard — re-selecting an already-visited tab re-fetches, because
 * staleness here is bounded only by "panel-open lifetime" (DD2), not by an
 * invalidation broadcast covering page-driven cookie churn.
 *
 * Views + staleness: a monotonic `viewGen` counter (the
 * `jars-history-panel.js` precedent, required per leg spec) is bumped by
 * every `refresh()` call; an async response paints only if its captured
 * token is still current — the defense against a concurrent Clear-cookies
 * racing an in-flight list query.
 *
 * No-confirm per-row delete (design review, verified convention): a row's
 * delete button removes immediately on click, matching the History panel's
 * row-delete convention exactly — no per-row confirm dialog.
 *
 * No `value` field anywhere in this module (DD7 least-privilege) — the
 * bridge's list response never carries one, so there is nothing to
 * accidentally render or forward.
 *
 * No unit suite for this module (house practice for page controllers,
 * `jars-history-panel.js` precedent) — static nets (typecheck/lint/grep-ACs)
 * only; live behavior verification is this leg's smoke check + a future
 * behavior-test gate.
 */

// ---------------------------------------------------------------------------
// Duplicated trash-2 icon (H3 / jars-history-panel.js precedent: NOT
// extracted to a third shared module — see that file's own doc comment for
// why). Identical shape list to jars.js's/jars-history-panel.js's copies.
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

/**
 * @param {number|null} expirationDate seconds since epoch, or null for a session cookie
 * @returns {string}
 */
function formatExpiry(expirationDate) {
  if (expirationDate == null) return 'Session';
  return new Date(expirationDate * 1000).toLocaleString();
}

/**
 * @param {{
 *   bridge: GoldfinchInternalBridge,
 *   jarId: string,
 *   mountEl: HTMLElement,
 *   onError: (message: string) => void
 * }} deps
 * @returns {{ onActivated: () => void, onJarDataChanged: () => void, destroy: () => void }}
 */
export function createCookiesPanel({ bridge, jarId, mountEl, onError }) {
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'jar-btn jar-datalist-refresh';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.setAttribute('aria-label', 'Refresh cookies');
  mountEl.appendChild(refreshBtn);

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
   * @param {{ name: string, domain: string, path: string, expirationDate: (number|null), secure: boolean, hostOnly: boolean, session: boolean }} row
   * @returns {HTMLLIElement}
   */
  function buildRow(row) {
    const li = document.createElement('li');
    li.className = 'jar-datalist-row';

    const textWrap = document.createElement('div');
    textWrap.className = 'jar-datalist-row-text';

    // Empty-name cookies (edge case — an `=value`-form cookie's `name` may
    // be '') render with an explicit placeholder rather than a blank line.
    const displayName = row.name === '' ? '(unnamed cookie)' : row.name;

    const primary = document.createElement('p');
    primary.className = 'jar-datalist-row-primary';
    primary.textContent = displayName;
    textWrap.appendChild(primary);

    const secondary = document.createElement('p');
    secondary.className = 'jar-datalist-row-secondary';
    secondary.textContent = `${row.domain} · expires ${formatExpiry(row.expirationDate)}`;
    textWrap.appendChild(secondary);

    li.appendChild(textWrap);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'jar-datalist-row-delete';
    deleteBtn.appendChild(buildIcon(ICON_DELETE));
    deleteBtn.setAttribute('aria-label', `Delete cookie: ${displayName} — ${row.domain}`);
    deleteBtn.addEventListener('click', () => {
      bridge
        .jarsCookiesRemove({ id: jarId, name: row.name, domain: row.domain, path: row.path, secure: row.secure })
        .then((result) => {
          if (!result || !result.ok) {
            onError('Could not delete cookie');
            return;
          }
          // No-confirm, immediate delete (design review, verified
          // convention) — re-query directly rather than waiting on the
          // jar-data-changed broadcast (DD10's "own-panel refresh still
          // direct" ruling), so the session read-back reflects the removal
          // right away.
          refresh();
        })
        .catch(() => onError('Could not delete cookie'));
    });
    li.appendChild(deleteBtn);

    return li;
  }

  /** Query + paint, guarded by the monotonic view-generation token. */
  function refresh() {
    viewGen += 1;
    const token = viewGen;
    bridge
      .jarsCookiesList({ id: jarId })
      .then((result) => {
        if (token !== viewGen) return; // stale — a newer query superseded this one
        if (!result || !result.ok) {
          onError('Could not load cookies');
          return;
        }
        const rows = Array.isArray(result.cookies) ? result.cookies : [];
        listEl.textContent = '';
        for (const row of rows) listEl.appendChild(buildRow(row));
        statusLine.textContent = rows.length === 0 ? 'No cookies stored in this jar' : '';
      })
      .catch(() => {
        if (token !== viewGen) return;
        onError('Could not load cookies');
      });
  }

  refreshBtn.addEventListener('click', () => refresh());

  function onActivated() {
    // Unlike History's onExpanded, this fires on EVERY activation — no
    // "first time only" guard (DD2: no live cookie subscription means only
    // a fresh read on open bounds staleness).
    hasActivatedOnce = true;
    refresh();
  }

  function onJarDataChanged() {
    // Never queried before this tab was ever opened — a broadcast arriving
    // for a jar whose Cookies tab hasn't been selected yet has nothing to
    // repaint; onActivated will fetch fresh whenever it eventually is.
    if (!hasActivatedOnce) return;
    refresh();
  }

  function destroy() {
    viewGen += 1; // kills any in-flight late paint
    mountEl.textContent = '';
  }

  return { onActivated, onJarDataChanged, destroy };
}
