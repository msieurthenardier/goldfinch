// PRELOAD-REACHABLE (flight-02 divert constraint): required by chrome-preload.js via the RENDERER
// process's Node require (no require(esm) support) — must stay CJS and must never require a
// converted ESM module.
'use strict';

// Single source of truth for the internal `goldfinch://` partition string. Required
// by BOTH the main process (session + protocol.handle) and the renderer (the trusted
// webview's `partition` attribute, via the chrome-preload bridge). The webview partition
// must match this byte-for-byte or the internal session serves nothing. No `persist:`
// prefix — the stub is static and has no state to persist (DD3).
module.exports = { INTERNAL_PARTITION: 'goldfinch-internal' };
