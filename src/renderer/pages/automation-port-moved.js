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

/**
 * The Port field edits the STORED setting (operator ruling 2026-11-19, squawk 0160), so the "unsaved" hint and
 * Save's dirty state both compare the field against the SAVED port, never the bound one. One source for both.
 * @param {{ value: string, savedPort: number | null, bound: boolean }} input
 * @returns {{ hint: string, saveDisabled: boolean }}
 */
export function portFieldState({ value, savedPort, bound }) {
  const n = Number(value);
  const valid = value !== '' && Number.isInteger(n) && n >= 1024 && n <= 65535;
  return {
    hint: bound && savedPort !== null && n !== savedPort ? '(unsaved — applies on Save)' : '',
    saveDisabled: !(valid && n !== savedPort)
  };
}

/**
 * Boot-time fallback only: the port a status carries (`configuredPort`, else `port`). NOT the persisted port under a GOLDFINCH_MCP_PORT pin; the settings read overwrites it.
 * @param {any} status
 * @returns {number | null}
 */
export function savedPortOf(status) {
  if (!status) return null;
  if (status.configuredPort != null) return Number(status.configuredPort);
  return status.port != null ? Number(status.port) : null;
}
