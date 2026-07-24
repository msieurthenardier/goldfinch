// goldfinch://vault serves imports through an exact flat allowlist; this module
// carries no imports of its own (every dependency is injected — the jars-nav
// precedent), so it needs only its own route in internal-page-map.js.

/**
 * Owns the dynamic Secrets sidebar and its section scroll-spy (M12 F5 HAT
 * hat-page-sidebar). A sibling to jars-nav-controller.js's createJarsNav, MIRRORED
 * rather than reused: the vault nav is heterogeneous AND two-level (a fixed "Settings"
 * gear entry, then a "Vaults" group parent whose indented children are a globe "Global"
 * entry and one color-dot entry per jar), where the jars nav is a flat homogeneous jar
 * list — so a shared abstraction would be mostly branches.
 *
 * Nav entries are plain anchors (`#vault-<id>`), the group's children nested in a
 * `<ul class="vault-nav-sublist">` inside the group `<li>`; selecting one jumps to its
 * section and the IntersectionObserver scroll-spy sets `aria-current` on the visible
 * section's entry — the exact keyboard/active-state model the jars rail uses (native
 * Tab through anchors across both levels, Enter activates, no custom roving). Every
 * entry (top-level and indented child) is registered flat in `navMap` by id, so
 * `setActive`/scroll-spy address the children directly.
 *
 * @param {{
 *   document: Document,
 *   Node: any,
 *   navEl: HTMLElement,
 *   IntersectionObserver: any,
 *   isSafeColor: (color: string) => boolean,
 *   fallbackColor: string
 * }} deps
 */
export function createVaultNav(deps) {
  const { document, Node, navEl, IntersectionObserver, isSafeColor, fallbackColor } = deps;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Build an inline SVG icon from a path/shape array — the ICON_EYE idiom from
   * jars-cookies-panel.js. `currentColor` stroke so the nav's active/hover color
   * flows through.
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
    svg.classList.add('vault-nav-icon');
    for (const shape of shapes) {
      const el = document.createElementNS(SVG_NS, shape.tag);
      for (const key of Object.keys(shape.attrs)) el.setAttribute(key, shape.attrs[key]);
      svg.appendChild(el);
    }
    return svg;
  }

  // Globe icon for the manager-wide Global vault entry (the leg's ICON_GLOBE — no
  // globe icon existed in the product before this leg).
  /** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
  const ICON_GLOBE = [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } },
    { tag: 'path', attrs: { d: 'M3 12h18' } },
    { tag: 'path', attrs: { d: 'M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z' } }
  ];

  // Gear icon for the top Settings entry (manager-wide controls).
  /** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
  const ICON_SETTINGS = [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
    { tag: 'path', attrs: { d: 'M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1' } }
  ];

  /** @type {Map<string, any>} */
  const navMap = new Map();
  /** @type {IntersectionObserver|null} */
  let scrollObserver = null;

  /** @param {string} id */
  function sectionIdFor(id) {
    return 'vault-' + id;
  }

  /**
   * Build one nav entry's `<li><a>marker? name</a></li>` record — a single (non-group)
   * entry OR a group's own header anchor. A group carries no marker (a bare header); a
   * jar carries a color dot; global/settings carry an inline icon.
   * @param {{ id: string, kind: string, label: string, color?: string|null }} entry
   */
  function buildNavEntry(entry) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + sectionIdFor(entry.id);

    /** @type {HTMLElement|null} */
    let marker = null;
    if (entry.kind === 'jar') {
      marker = document.createElement('span');
      marker.className = 'vault-nav-dot';
    } else if (entry.kind === 'global') {
      marker = /** @type {any} */ (buildIcon(ICON_GLOBE));
    } else if (entry.kind === 'settings') {
      marker = /** @type {any} */ (buildIcon(ICON_SETTINGS));
    }
    if (marker) a.appendChild(marker);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'vault-nav-name';
    a.appendChild(nameSpan);

    li.appendChild(a);
    const record = { li, a, marker, nameSpan, kind: entry.kind, sublist: /** @type {any} */ (null) };
    updateNavEntry(record, entry);
    return record;
  }

  /** @param {any} record @param {{ label: string, color?: string|null }} entry */
  function updateNavEntry(record, entry) {
    record.nameSpan.textContent = entry.label;
    if (record.kind === 'jar') {
      const color = entry.color;
      record.marker.style.background = color && isSafeColor(color) ? color : fallbackColor;
    }
  }

  /**
   * Full rebuild: clear the nav and rebuild every top-level entry, nesting a group's
   * children into a `<ul class="vault-nav-sublist">` inside the group's `<li>`. Every
   * entry — top-level and child — is registered in `navMap` by id (flat keyspace), so
   * `setActive`/scroll-spy address the indented children directly.
   * @param {Array<any>} entries
   */
  function rebuild(entries) {
    navEl.textContent = '';
    navMap.clear();
    for (const entry of entries) {
      const record = buildNavEntry(entry);
      navMap.set(entry.id, record);
      navEl.appendChild(record.li);
      if (entry.kind === 'group') {
        const sublist = document.createElement('ul');
        sublist.className = 'vault-nav-sublist';
        sublist.setAttribute('role', 'list');
        record.li.appendChild(sublist);
        record.sublist = sublist;
        record.li.classList.add('vault-nav-group');
        for (const child of entry.children || []) {
          const childRecord = buildNavEntry(child);
          navMap.set(child.id, childRecord);
          sublist.appendChild(childRecord.li);
        }
      }
    }
  }

  /**
   * Render the two-level nav (Settings + a Vaults group with indented children).
   *
   * When focus lives inside the nav, patch in place rather than rebuild (the shared
   * caret/focus-preservation house rule): the top-level shape is fixed (Settings + the
   * Vaults group), so only the group's children set changes — reconcile it within the
   * group's sublist by id, preserving the focused anchor. Any unexpected top-level
   * shape change falls back to a full rebuild.
   * @param {Array<any>} entries
   */
  function render(entries) {
    const focusedInNav = document.activeElement instanceof Node && navEl.contains(document.activeElement);
    if (!focusedInNav || navMap.size === 0) {
      rebuild(entries);
      return;
    }

    const settingsEntry = entries.find((e) => e.kind === 'settings');
    const groupEntry = entries.find((e) => e.kind === 'group');
    const groupRecord = groupEntry && navMap.get(groupEntry.id);
    if (!settingsEntry || !navMap.get(settingsEntry.id) || !groupRecord || !groupRecord.sublist) {
      rebuild(entries);
      return;
    }

    updateNavEntry(navMap.get(settingsEntry.id), settingsEntry);
    updateNavEntry(groupRecord, groupEntry);

    const children = groupEntry.children || [];
    const childIds = new Set(children.map((c) => c.id));
    // Drop children no longer present (never the fixed top-level Settings/group records).
    for (const id of Array.from(navMap.keys())) {
      if (id === settingsEntry.id || id === groupEntry.id) continue;
      if (!childIds.has(id)) {
        navMap.get(id).li.remove();
        navMap.delete(id);
      }
    }

    let previous = null;
    for (const child of children) {
      let record = navMap.get(child.id);
      if (!record) {
        record = buildNavEntry(child);
        navMap.set(child.id, record);
      } else {
        updateNavEntry(record, child);
      }
      if (previous == null) {
        if (groupRecord.sublist.firstChild !== record.li) {
          groupRecord.sublist.insertBefore(record.li, groupRecord.sublist.firstChild);
        }
      } else if (previous.nextSibling !== record.li) {
        groupRecord.sublist.insertBefore(record.li, previous.nextSibling);
      }
      previous = record.li;
    }
  }

  /** @param {string} sectionElementId  e.g. 'vault-settings' / 'vault-<vaultId>' */
  function setActive(sectionElementId) {
    for (const [id, record] of navMap) {
      if (sectionIdFor(id) === sectionElementId) record.a.setAttribute('aria-current', 'true');
      else record.a.removeAttribute('aria-current');
    }
  }

  /**
   * Observe the rendered section elements and drive `aria-current` from the topmost
   * visible one — the jars scroll-spy, minus the per-jar history-panel side effect.
   * @param {Array<HTMLElement>} sectionEls
   */
  function observe(sectionEls) {
    if (scrollObserver) scrollObserver.disconnect();
    const sections = sectionEls.filter(Boolean);
    if (!sections.length) {
      scrollObserver = null;
      return;
    }
    const visible = new Set();
    scrollObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      for (const section of sections) {
        if (visible.has(section.id)) {
          setActive(section.id);
          return;
        }
      }
      // Top inset (-48px) must exceed .vault-section's scroll-margin-top (24px in
      // vault.css): an anchor jump lands the target's top ~24px down, leaving the
      // PREVIOUS section's bottom sliver in the top band — with a 0 top inset that
      // earlier-in-DOM sliver wins the topmost-visible loop and the nav highlights the
      // entry ABOVE the clicked one. Insetting past the scroll-margin excludes it.
    }, { rootMargin: '-48px 0px -50% 0px', threshold: 0 });
    for (const section of sections) scrollObserver.observe(section);
  }

  function destroy() {
    if (scrollObserver) scrollObserver.disconnect();
    scrollObserver = null;
  }

  return { render, setActive, observe, destroy, sectionIdFor };
}
