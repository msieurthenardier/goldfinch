// @ts-check
// The automation page's "the port moved" line (Mission 23 Flight 2, leg `port-and-permissions`, flight DD5).
// Drawn from `automation:get-status`'s `configuredPort` and `port`, never from the activity snapshot. Patched
// in place: the element is only ever written, never rebuilt. The line builder is an injected dependency (the
// shared `portMovedLine`, imported by automation.js through its flat specifier) so this file runs under
// `node --test` against a fake element.

/**
 * @param {{ el: { textContent: string | null, hidden: boolean | string } | null,
 *           status: any,
 *           portMovedLine: (configured: unknown, bound: unknown) => string | null }} deps
 * @returns {string | null} the line now shown, or null when none is
 */
export function renderPortMoved({ el, status, portMovedLine }) {
  const line = status && status.bound ? portMovedLine(status.configuredPort, status.port) : null;
  if (el) {
    el.textContent = line === null ? '' : line;
    el.hidden = line === null;
  }
  return line;
}
