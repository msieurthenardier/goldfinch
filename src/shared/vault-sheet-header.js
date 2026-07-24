// @ts-check

// Shared header for the vault menu-overlay sheets (the picker + the unlock prompt, and
// any future vault sheet that wants a consistent chrome). A title on the left + a visible
// close (X) button on the right, so the sheet reads as a real modal and is obviously
// dismissable — the picker's empty state previously offered no visible way to close (only
// a non-obvious click-outside / Escape). Pure, document-injected (the src/shared/ pattern),
// so menu-overlay.js wires the returned `close` button's behavior and it unit-tests headlessly.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build the close (X) glyph as inline SVG (never innerHTML / emoji) — two crossed strokes.
 * Decorative (aria-hidden); the button carries the accessible name.
 * @param {Document} document
 * @returns {SVGElement}
 */
function buildCloseGlyph(document) {
  const svg = /** @type {any} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const a = document.createElementNS(SVG_NS, 'path');
  a.setAttribute('d', 'M6 6 L18 18');
  const b = document.createElementNS(SVG_NS, 'path');
  b.setAttribute('d', 'M18 6 L6 18');
  svg.appendChild(a);
  svg.appendChild(b);
  return svg;
}

/**
 * Build a `.vault-sheet-header` (title + close button). The caller wires the `close`
 * button's click (a deliberate dismiss). The title uses textContent only — never markup.
 * @param {Document} document
 * @param {string} title  the sheet's heading text.
 * @returns {{ header: HTMLElement, title: HTMLElement, close: HTMLButtonElement }}
 */
export function buildVaultSheetHeader(document, title) {
  const header = document.createElement('div');
  header.className = 'vault-sheet-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'vault-sheet-title';
  titleEl.textContent = String(title == null ? '' : title);

  const close = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  close.className = 'vault-sheet-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(buildCloseGlyph(document));

  header.appendChild(titleEl);
  header.appendChild(close);
  return { header, title: titleEl, close };
}
