/**
 * Owns the dynamic jars sidebar and its section scroll-spy.
 * @param {{
 *   document: Document,
 *   Node: any,
 *   navEl: HTMLElement,
 *   IntersectionObserver: any,
 *   isSafeColor: (color: string) => boolean,
 *   fallbackColor: string,
 *   getSectionRefs: (rowId: string) => any,
 *   sectionSetKey: (rows: any[]) => string
 * }} deps
 */
export function createJarsNav(deps) {
  const {
    document,
    Node,
    navEl,
    IntersectionObserver,
    isSafeColor,
    fallbackColor,
    getSectionRefs,
    sectionSetKey
  } = deps;

  /** @type {Map<string, any>} */
  const navMap = new Map();
  /** @type {IntersectionObserver|null} */
  let scrollObserver = null;
  /** @type {string|null} */
  let lastSectionsKey = null;

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

  function updateNavEntry(entry, row) {
    entry.dot.style.background = isSafeColor(row.color) ? row.color : fallbackColor;
    entry.nameSpan.textContent = row.name;
    entry.badge.hidden = !row.isDefault;
  }

  function render(rows) {
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

    const rowIds = new Set(rows.map((row) => row.id));
    for (const id of Array.from(navMap.keys())) {
      if (!rowIds.has(id)) {
        navMap.get(id).li.remove();
        navMap.delete(id);
      }
    }

    let previous = null;
    for (const row of rows) {
      let entry = navMap.get(row.id);
      if (!entry) {
        entry = buildNavEntry(row);
        navMap.set(row.id, entry);
      } else {
        updateNavEntry(entry, row);
      }
      if (previous == null) {
        if (navEl.firstChild !== entry.li) navEl.insertBefore(entry.li, navEl.firstChild);
      } else if (previous.nextSibling !== entry.li) {
        navEl.insertBefore(entry.li, previous.nextSibling);
      }
      previous = entry.li;
    }
  }

  function setActiveNav(sectionElementId) {
    const rowId = sectionElementId.slice('jar-'.length);
    for (const [id, entry] of navMap) {
      if (id === rowId) entry.a.setAttribute('aria-current', 'true');
      else entry.a.removeAttribute('aria-current');
    }
  }

  function observeSectionsIfChanged(rows) {
    const key = sectionSetKey(rows);
    if (key === lastSectionsKey) return;
    lastSectionsKey = key;
    if (scrollObserver) scrollObserver.disconnect();

    const sections = rows.map((row) => getSectionRefs(row.id)?.root).filter(Boolean);
    if (!sections.length) {
      scrollObserver = null;
      return;
    }

    const visible = new Set();
    scrollObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target.id);
          const rowId = entry.target.id.slice('jar-'.length);
          getSectionRefs(rowId)?.historyPanel?.onExpanded();
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
    }, { rootMargin: '0px 0px -50% 0px', threshold: 0 });
    for (const section of sections) scrollObserver.observe(section);
  }

  function destroy() {
    if (scrollObserver) scrollObserver.disconnect();
    scrollObserver = null;
  }

  return { render, observeSectionsIfChanged, setActiveNav, destroy };
}
