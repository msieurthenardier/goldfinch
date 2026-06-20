// @ts-check
'use strict';

/* ------------------------------------------------------- shared menu controller */
// One in-file controller owns open/close + mutual-exclusion + outside-dismiss for
// every dropdown menu (kebab overflow, container picker). Each menu registers an
// entry whose `onOpen`/`onClose` are its RAW show/hide bodies — never the public
// `closeX` wrapper (the wrapper delegates back into the controller, so reusing it
// as `onClose` would recurse: close → onClose → closeX → close → …). The public
// wrapper and the raw `onClose` are deliberately two distinct functions.

const menuController = (() => {
  /** @type {MenuEntry[]} */
  const entries = [];
  /** @type {MenuEntry|null} */
  let open = null; // currently-open entry or null
  /** @param {MenuEntry} entry @param {number} [startIndex] */
  function openEntry(entry, startIndex = 0) {
    closeAll(); // mutual-exclusion: opening one menu dismisses any other
    entry.onOpen?.(startIndex); // menu-specific: build items, show, position, focus, aria
    open = entry;
  }
  /** @param {MenuEntry} entry */
  function closeEntry(entry) {
    entry.onClose?.(); // raw hide body — NOT the public wrapper (avoids recursion)
    if (open === entry) open = null;
  }
  function closeAll() {
    if (open) closeEntry(open);
  }
  /** @param {MenuEntry} entry @returns {MenuEntry} */
  function register(entry) {
    entries.push(entry);

    // Controller-level trigger keydown: Enter/Space/ArrowDown → open to first item;
    // ArrowUp → open to last item (APG menu-button). preventDefault suppresses the
    // synthetic click so the menu opens exactly once.
    // Skip when trigger === menu (the page context menu is its OWN trigger node, with no separate
    // menu-button): otherwise this opener fires on the menu's own Arrow/Enter keydowns and
    // closeAll()s it mid-navigation. Such consumers open programmatically (right-click / Shift+F10).
    if (entry.trigger !== entry.menu) {
      entry.trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          openEntry(entry, 0);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          openEntry(entry, -1);
        }
      });
    }

    // Controller-level menu keydown: full APG roving-tabindex contract.
    // Guard `if (!entry.items) return` so a non-menu popup consumer (e.g. the
    // site-info popup in leg 5) can register without an items-getter and the
    // roving/arrow contract simply no-ops for it.
    entry.menu.addEventListener('keydown', (e) => {
      if (!entry.items) return;
      const items = entry.items();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEntry(entry);
        // Focus-return: an entry may supply an additive focusReturn() (the page context menu, which
        // has no persistent trigger button — DD3/step-3a); else default to focusing the trigger
        // exactly as before. The 3 toolbar consumers omit focusReturn and keep entry.trigger.focus().
        if (entry.focusReturn) entry.focusReturn();
        else entry.trigger.focus();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeEntry(entry);
        if (entry.focusReturn) entry.focusReturn(); // Tab/Shift+Tab close the menu and return focus
        else entry.trigger.focus();
      } else {
        // Arrow/Home/End require items; guard before calling focusItem (wrap formula
        // NaN-s on an empty list — cheap safety net even though an open menu always has items).
        if (!items.length) return;
        const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusItem(items, idx + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          focusItem(items, idx - 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          focusItem(items, 0);
        } else if (e.key === 'End') {
          e.preventDefault();
          focusItem(items, items.length - 1);
        }
      }
    });

    return entry;
  }
  return {
    register,
    open: openEntry,
    close: closeEntry,
    closeAll,
    get current() {
      return open;
    }
  };
})();

// Target-aware outside-dismiss for all registered menus. pointerdown fires before
// focus shifts, and the menu-dismissal CDP clicks dispatch pointerdown→click, so
// this catches in-chrome clicks (address bar, neutral chrome). A click inside the
// open menu or on its own trigger is ignored (item handlers / the trigger's own
// toggle do their thing); a click on the OTHER trigger is handled by that trigger's
// open() (which closeAll()s first). Outside-dismiss does NOT restore focus to the
// trigger — only Escape/Tab do that.
document.addEventListener('pointerdown', (e) => {
  const cur = menuController.current;
  if (!cur) return;
  const t = /** @type {Node} */ (e.target);
  if (cur.menu.contains(t) || cur.trigger.contains(t)) return;
  menuController.closeAll();
});
// Page/webview clicks (a separate web-contents the chrome document can't see) and
// app-switch both fire window blur → close any open menu (DD1, spike-confirmed).
window.addEventListener('blur', () => menuController.closeAll());

/** @param {HTMLElement[]} items @param {number} i */
function focusItem(items, i) {
  const n = ((i % items.length) + items.length) % items.length; // wrap, handles negatives
  items.forEach((el, j) => (el.tabIndex = j === n ? 0 : -1)); // roving tabindex
  items[n].focus();
}

// Dual export: CommonJS (main process + test runner) and global (renderer, which
// runs with nodeIntegration:false and cannot require()). Mirrors the shared
// predicate modules (url-safety.js / keydown-action.js). The renderer loads this
// file via <script> BEFORE renderer.js, so menuController/focusItem are globals by
// the time renderer.js registers its menu entries at eval time.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { menuController, focusItem };
} else {
  /** @type {any} */ (globalThis).menuController = menuController;
  /** @type {any} */ (globalThis).focusItem = focusItem;
}
