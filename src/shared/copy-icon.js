// @ts-check

// Pure, document-injected builder for the app's inline "copy" glyph — the same
// createElementNS-only idiom the jars/settings pages use for their SVG icons (16×16
// box, viewBox 24×24, stroke=currentColor so it inherits the button's text color).
// Built entirely via createElementNS / setAttribute — NEVER innerHTML / a template
// string — so it is safe under the strict internal CSP and the sheet's textContent-only
// discipline. Shared by the vault one-time-display sheet templates' Copy buttons (M12
// HAT batch 1, I2–I4).

const SVG_NS = 'http://www.w3.org/2000/svg';

// Lucide "copy" path data (ISC license) — the same icon set/style vendored elsewhere
// in the app (jars/settings/toolbar glyphs).
/** @type {ReadonlyArray<{ tag: string, attrs: Record<string, string> }>} */
const COPY_SHAPES = [
  { tag: 'rect', attrs: { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' } },
  { tag: 'path', attrs: { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' } },
];

/**
 * Build the inline copy-glyph SVG. Decorative (`aria-hidden`, non-focusable) — the
 * button's own text label ("Copy") carries the accessible name.
 * @param {Document} document
 * @returns {SVGSVGElement}
 */
export function buildCopyIcon(document) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('vault-copy-icon');
  for (const shape of COPY_SHAPES) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const key of Object.keys(shape.attrs)) el.setAttribute(key, shape.attrs[key]);
    svg.appendChild(el);
  }
  return svg;
}
