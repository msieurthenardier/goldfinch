// @ts-check

// Pure, document-injected builder for the app's inline "bookmark star" glyph — the
// same createElementNS-only idiom as copy-icon.js (never innerHTML / a template
// string, safe under the strict internal CSP and the sheet's textContent-only
// discipline). Used by the suggestions-sheet bookmark-row badge (M15 F1 Leg 5 HAT
// fix I2: replaces the prior text badge, `textContent = 'Bookmark'`).
//
// Same Lucide "star" path data as the address-bar `#star` button glyph
// (src/renderer/index.html) — one glyph source for "this is a bookmark" across the
// chrome. Rendered FILLED (`fill="currentColor"`, `stroke="none"`), unlike the
// address-bar star's stroked-outline default state: the address bar's outline vs.
// fill distinguishes unstarred vs. starred, but a suggestions row carrying this
// badge is by definition already a bookmark, and a stroked outline is illegible at
// the badge's small size.
//
// Purely decorative — callers MUST keep `aria-hidden` on this element (or its
// container) and carry the accessible "bookmark" signal via a separate text node
// (sr-only / aria-describedby on the row), never via this glyph's shape alone.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Lucide "star" path data (ISC license) — identical `d` to index.html's #star glyph.
const STAR_PATH_D =
  'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';

/**
 * Build the inline bookmark-star glyph, filled solid — decorative only
 * (`aria-hidden`, non-focusable).
 * @param {Document} document
 * @returns {SVGSVGElement}
 */
export function buildBookmarkStarIcon(document) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 24 24');
  // No `width`/`height` presentation attributes (M15 F2 Leg 3, DD12(b)): they
  // defeated CSS sizing on the suggestions-row badge — `.sg-badge-star` sizes
  // it via CSS instead, letting it render at row height.
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('stroke', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('sg-badge-star');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', STAR_PATH_D);
  svg.appendChild(path);
  return svg;
}
