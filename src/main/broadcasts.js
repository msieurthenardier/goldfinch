'use strict';

// Construct the three process-wide push helpers from live authorities. No
// cache is introduced: records and webContents are enumerated per broadcast.
function createBroadcasters({
  registry,
  webContents,
  isInternalContents,
  closedTabStack,
  buildMoveTargets
}) {
  function liveChrome(record) {
    const contents = record.chromeView.webContents;
    return contents && !contents.isDestroyed() ? contents : null;
  }

  function broadcastClosedTabStackChanged() {
    // Chrome-only push cache. Internal pages have no consumer; the invoke
    // channel remains only the renderer's boot seed.
    const payload = { size: closedTabStack.size() };
    for (const record of registry.records()) {
      liveChrome(record)?.send('closed-tab-stack-changed', payload);
    }
  }

  function broadcastMoveTargetsChanged() {
    // Per-record payload: a window must never be offered itself. Only labels
    // are cached renderer-side; echoed window ids are re-authorized at act time.
    const records = registry.records();
    for (const record of records) {
      liveChrome(record)?.send('move-targets-changed', { targets: buildMoveTargets(records, record) });
    }
  }

  function broadcastToChromeAndInternal(channel, payload) {
    // Chromes are sent separately from the global internal-session walk. This
    // prevents ordinary guests from receiving privileged app-state pushes and
    // prevents an internal page from being sent once per window.
    for (const record of registry.records()) {
      liveChrome(record)?.send(channel, payload);
    }
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed() && isInternalContents(contents)) {
        contents.send(channel, payload);
      }
    }
  }

  return {
    broadcastClosedTabStackChanged,
    broadcastMoveTargetsChanged,
    broadcastToChromeAndInternal
  };
}

module.exports = { createBroadcasters };
