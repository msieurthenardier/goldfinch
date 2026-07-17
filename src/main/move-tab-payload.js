// @ts-check
'use strict';

// Move-to-new-window payload rules (M09 Flight 6, DD5 + leg-4 design review H2).
// Pure, Electron-free (the window-registry / closed-tab-capture precedent) so the
// shape rules are unit-pinned offline.
//
// H2: the `tab-move-to-new-window` invoke carries the SOURCE RENDERER's strip
// snapshot — {wcId, url, title, favicon, container} — because main cannot
// rebuild everything from the wcId: a burner's synthesized container object and
// the favicon exist ONLY renderer-side. The trust domain is chrome→chrome
// (source chrome → main → target chrome), but main still SHAPE-VALIDATES the
// payload before relaying it into `adopt-tab`, and re-derives what it CAN —
// url/title come from the live webContents at SEND time (main-authoritative),
// with the renderer snapshot as the fallback.

/**
 * @typedef {{ id: string, name: string, color: string, partition: string, burner?: boolean }} ContainerSnapshot
 * @typedef {{ wcId: number, url: string, title: string, favicon: string | null, container: ContainerSnapshot }} MoveTabPayload
 */

/**
 * Shape-validate the renderer's move payload. Returns a NORMALIZED copy (only
 * the known fields, container reduced to its five known keys) or null when the
 * shape is wrong — the handler refuses with a silent no-op, never throws.
 * @param {any} payload
 * @returns {MoveTabPayload | null}
 */
function validateMoveTabPayload(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  const { wcId, url, title, favicon, container } = payload;
  if (typeof wcId !== 'number' || !Number.isInteger(wcId)) return null;
  if (typeof url !== 'string' || typeof title !== 'string') return null;
  if (favicon != null && typeof favicon !== 'string') return null;
  if (container === null || typeof container !== 'object') return null;
  if (
    typeof container.id !== 'string' ||
    typeof container.name !== 'string' ||
    typeof container.color !== 'string' ||
    typeof container.partition !== 'string'
  ) {
    return null;
  }
  return {
    wcId,
    url,
    title,
    favicon: typeof favicon === 'string' ? favicon : null,
    container: {
      id: container.id,
      name: container.name,
      color: container.color,
      partition: container.partition,
      ...(container.burner === true ? { burner: true } : {}),
    },
  };
}

/**
 * Build the `adopt-tab` payload from a validated move payload + the live
 * webContents at SEND time (H2: main-authoritative url/title where readable;
 * favicon/container are renderer-only facts and ride the snapshot verbatim).
 * `wc` is duck-typed ({ isDestroyed, getURL, getTitle }) so this stays
 * Electron-free and offline-testable.
 * @param {MoveTabPayload} p
 * @param {{ isDestroyed: () => boolean, getURL: () => string, getTitle: () => string } | null} wc
 * @returns {{ wcId: number, url: string, title: string, favicon: string | null, container: ContainerSnapshot }}
 */
function buildAdoptPayload(p, wc) {
  const live = wc && !wc.isDestroyed() ? wc : null;
  return {
    wcId: p.wcId,
    url: (live && live.getURL()) || p.url,
    title: (live && live.getTitle()) || p.title,
    favicon: p.favicon,
    container: p.container,
  };
}

module.exports = { validateMoveTabPayload, buildAdoptPayload };
