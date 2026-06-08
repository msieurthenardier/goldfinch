'use strict';

// Single source of truth for the internal `goldfinch://` partition string. Required
// by BOTH the main process (session + protocol.handle) and the renderer (the trusted
// webview's `partition` attribute, via the chrome-preload bridge). The webview partition
// must match this byte-for-byte or the internal session serves nothing. No `persist:`
// prefix — the stub is static and has no state to persist (DD3).
module.exports = { INTERNAL_PARTITION: 'goldfinch-internal' };
