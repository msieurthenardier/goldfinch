// @ts-check

/**
 * jars-cookies-panel.js — the Cookies panel's content module (M10 Flight 2
 * Leg 2 / flight DD2, DD7). Cloned from `jars-history-panel.js`'s shape:
 * jars.js builds one instance per persistent jar's Cookies region and
 * delegates to it; this module owns everything INSIDE the mount
 * `<div class="jar-cookies-mount">` it is handed — the cookie list and
 * per-row delete. It never reaches jars.js's page-level transient/reconcile
 * state or its per-section DOM registry, and never touches anything outside
 * its own `mountEl`.
 *
 * DOM contract (mirrors DD7's History contract): the Cookies region has
 * exactly two children — jars.js's own `.jar-data-controls` block
 * (Clear-cookies button + confirm) and this module's mount. jars.js never
 * writes inside the mount; this module never touches the controls block or
 * the region node itself.
 *
 * Manual refresh trigger (M10 Flight 3 HAT fix-rider B, operator-requested):
 * the refresh AFFORDANCE — an icon-only button, right-justified into jars.js's
 * own `.jar-data-controls-buttons` row alongside the Clear-cookies button —
 * now lives in jars.js, NOT in this module's mount (supersedes the earlier
 * full-text "Refresh" button this module used to build and own). This module
 * still owns the underlying `refresh()` QUERY logic exclusively — it is
 * exposed as a returned hook (`refresh`) that jars.js's button click calls;
 * the DOM-ownership split stays clean (jars.js only ever appends into its own
 * controls block, this module only ever writes inside its own mount) even
 * though the trigger now lives outside the mount.
 *
 * Tab-badge count (M10 Flight 3 HAT fix-rider A, design review cycle 1 + FD
 * revision rulings): an optional `onCountChanged(n)` constructor dep fires
 * after EVERY successful `refresh()` paint with the fresh list length —
 * jars.js routes it into this panel's own tab badge. This is what keeps an
 * OPEN Cookies tab's badge accurate across this panel's OWN per-row deletes,
 * which deliberately never broadcast (the "own-panel refresh still direct"
 * ruling below) — a page-level count re-fetch would otherwise only catch up
 * on the NEXT `jar-data-changed` broadcast.
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
 * invalidation broadcast covering page-driven cookie churn. This is the LIST
 * fetch's own gating, UNCHANGED by fix-rider A — the tab-strip's BUILD-TIME
 * count pass (jars.js's fetchCookiesCount, see that module's Tab counts doc
 * comment) is a SEPARATE, bounded one-shot query per page load (one
 * `cookies.get` per persistent jar), not a second live-probe trigger on this
 * panel's own activation/broadcast gating — a per-scroll live-probe shape for
 * the count pass was considered and REJECTED at design review in favor of
 * mirroring History's existing build-time-unconditional mechanism.
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
 * No `value` field anywhere in the LIST response (DD7 least-privilege) — the
 * bridge's list response never carries one, so there is nothing to
 * accidentally render or forward from that call.
 *
 * Per-row value reveal (F3 HAT walkthrough fix-rider, operator-requested):
 * an eyeball toggle button per row fetches the cookie's value on demand via
 * `bridge.jarsCookiesValue` (a SEPARATE, narrower IPC call — the list
 * response above still never carries a value) and renders it inline in a
 * `.textContent`-only span (never innerHTML — the value is a site-controlled
 * string surfacing inside a privileged internal page). Re-click hides and
 * REMOVES the value node — nothing is cached in JS state beyond the
 * currently-revealed fetch; a list re-render (refresh/jar-data-changed/tab
 * switch) rebuilds every row from scratch, so reveals reset to hidden for
 * free. Each row carries its OWN generation counter (the panel's `viewGen`
 * idiom, scoped per-row) so a hide-before-fetch-resolves race can never
 * paint a value into a row the operator already re-hid.
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

// Eyeball reveal-toggle icon (F3 HAT walkthrough fix-rider). The icon shape
// stays FIXED across both states — `aria-pressed` + the dynamic `aria-label`
// (below) carry the state, the same convention the .jar-tab[aria-selected]
// treatment on this page already relies on rather than swapping glyphs.
/** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
const ICON_EYE = [
  { tag: 'path', attrs: { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' } },
  { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } }
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
 *   onError: (message: string) => void,
 *   onCountChanged?: (count: number) => void
 * }} deps
 * @returns {{ onActivated: () => void, onJarDataChanged: () => void, refresh: () => void, destroy: () => void }}
 */
export function createCookiesPanel({ bridge, jarId, mountEl, onError, onCountChanged }) {
  // Manual-refresh BUTTON lives in jars.js now (M10 Flight 3 HAT fix-rider
  // B — module doc comment) — this module keeps only the refresh() QUERY
  // logic, exposed below as a returned hook for jars.js's button to call.
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

    // `nameSpan` stays the SOLE holder of the displayed name — the reveal
    // toggle below appends/removes a SIBLING value span rather than touching
    // this node, so hiding never has to reconstruct the name text.
    const primary = document.createElement('p');
    primary.className = 'jar-datalist-row-primary';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = displayName;
    primary.appendChild(nameSpan);
    textWrap.appendChild(primary);

    const secondary = document.createElement('p');
    secondary.className = 'jar-datalist-row-secondary';
    secondary.textContent = `${row.domain} · expires ${formatExpiry(row.expirationDate)}`;
    textWrap.appendChild(secondary);

    li.appendChild(textWrap);

    const controls = document.createElement('div');
    controls.className = 'jar-datalist-row-controls';

    // Per-cookie value reveal (F3 HAT walkthrough fix-rider,
    // operator-requested). `revealGen` is this ROW's OWN generation token
    // (the panel-level `viewGen` idiom, scoped per-row rather than
    // per-panel) — bumped on EVERY toggle click (both reveal and hide), so a
    // hide that lands while a reveal fetch is still in flight makes that
    // fetch's eventual resolution a no-op: a hidden row must never paint a
    // late-arriving value.
    let revealed = false;
    let revealGen = 0;
    /** @type {HTMLElement|null} */
    let valueEl = null;

    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'jar-datalist-row-reveal';
    revealBtn.appendChild(buildIcon(ICON_EYE));
    revealBtn.setAttribute('aria-pressed', 'false');
    revealBtn.setAttribute('aria-label', `Show value for ${displayName}`);

    function setHiddenState() {
      revealed = false;
      if (valueEl) {
        valueEl.remove();
        valueEl = null;
      }
      revealBtn.setAttribute('aria-pressed', 'false');
      revealBtn.setAttribute('aria-label', `Show value for ${displayName}`);
    }

    revealBtn.addEventListener('click', () => {
      revealGen += 1;
      const token = revealGen;
      if (revealed) {
        setHiddenState();
        return;
      }
      revealed = true;
      revealBtn.setAttribute('aria-pressed', 'true');
      revealBtn.setAttribute('aria-label', `Hide value for ${displayName}`);
      bridge
        .jarsCookiesValue({ id: jarId, name: row.name, domain: row.domain, path: row.path })
        .then((result) => {
          if (token !== revealGen) return; // superseded by a later toggle on this row
          if (!result || !result.ok) {
            onError('Could not load cookie value');
            setHiddenState();
            return;
          }
          valueEl = document.createElement('span');
          valueEl.className = 'jar-datalist-row-value';
          // .textContent ONLY — never innerHTML. The value is a
          // site-controlled string rendering inside a privileged internal
          // page; textContent is the load-bearing XSS guard here.
          valueEl.textContent = result.value;
          primary.appendChild(valueEl);
        })
        .catch(() => {
          if (token !== revealGen) return;
          onError('Could not load cookie value');
          setHiddenState();
        });
    });
    controls.appendChild(revealBtn);

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
    controls.appendChild(deleteBtn);

    li.appendChild(controls);

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
        // M10 Flight 3 HAT fix-rider A: report the fresh count to jars.js's
        // tab badge after EVERY successful paint (tab activation, manual
        // refresh, this panel's own per-row delete, and a de-duped
        // onJarDataChanged alike) — module doc comment.
        onCountChanged?.(rows.length);
      })
      .catch(() => {
        if (token !== viewGen) return;
        onError('Could not load cookies');
      });
  }

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

  return { onActivated, onJarDataChanged, refresh, destroy };
}
