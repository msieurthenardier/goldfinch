'use strict';

// Sortie 06 Leg 1 (AC18): `registerOverlayIpc` now delegates sender resolution to
// `registry.recordForOverlaySender(sender, key)` (extracted from a closure inside
// register-overlay-ipc.js). Offline overlay tests build minimal fake registries
// (`{ records, getWindowForChrome }`); this wrapper adds the SAME identity lookup the real
// registry implements, so those tests keep exercising the real resolution semantics.

/**
 * @template {{ records: () => any[] }} R
 * @param {R} registryLike
 * @returns {R & { recordForOverlaySender: (sender: any, key: string) => any }}
 */
function withOverlaySenderLookup(registryLike) {
  const lookup = (sender, key) => {
    if (!sender) return null;
    for (const rec of registryLike.records()) {
      const manager = rec[key];
      const view = manager ? manager.getView() : null;
      if (view && !view.webContents.isDestroyed() && view.webContents === sender) return rec;
    }
    return null;
  };
  return Object.assign(registryLike, { recordForOverlaySender: lookup });
}

module.exports = { withOverlaySenderLookup };
