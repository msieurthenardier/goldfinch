'use strict';

/**
 * settings.js — scroll-spy progressive enhancement.
 *
 * Sets aria-current="true" on the nav link whose section is currently in the
 * viewport; removes it from all other links. Pure enhancement: the page is
 * fully navigable without this script (native anchor links carry navigation).
 *
 * CSP: served as a same-origin subresource under default-src 'self' (no
 * 'unsafe-inline'). No inline event handlers; no dynamic script injection.
 */

(function () {
  // Collect all sections that have a corresponding nav link.
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const navLinks = Array.from(
    document.querySelectorAll('nav[aria-label="Settings sections"] a[href^="#"]')
  );

  if (!sections.length || !navLinks.length) return;

  // Build a map from section id → nav link element.
  /** @type {Map<string, HTMLAnchorElement>} */
  const linkMap = new Map();
  for (const link of navLinks) {
    const id = link.getAttribute('href').slice(1); // strip leading '#'
    linkMap.set(id, /** @type {HTMLAnchorElement} */ (link));
  }

  /**
   * Mark the given section's nav link as current; clear all others.
   * @param {string} activeId
   */
  function setActive(activeId) {
    for (const [id, link] of linkMap) {
      if (id === activeId) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }

  // Track which sections are intersecting.
  /** @type {Set<string>} */
  const visible = new Set();

  const observer = new IntersectionObserver(
    function (entries) {
      for (const entry of entries) {
        const id = entry.target.id;
        if (entry.isIntersecting) {
          visible.add(id);
        } else {
          visible.delete(id);
        }
      }

      // Activate the first section (in document order) that is currently visible.
      for (const section of sections) {
        if (visible.has(section.id)) {
          setActive(section.id);
          return;
        }
      }
      // Nothing visible — leave the last active link as-is (avoids flash on fast scroll).
    },
    {
      // Trigger when a section crosses the midpoint of the viewport.
      rootMargin: '0px 0px -50% 0px',
      threshold: 0
    }
  );

  for (const section of sections) {
    observer.observe(section);
  }
})();
