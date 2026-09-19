'use strict';

// Shared isolated-world global-handle name (Mission 21, Flight 1, Leg 3 —
// entry-tracker, DD3g/DD3h). Required by BOTH vault-entry-tracker.js (the
// main-world module that BUILDS the runtime call-into-isolated-world script
// text) and vault-entry-observer-bootstrap.js (the esbuild entry point that
// INSTALLS the observer under this name inside the isolated world) so the two
// can never drift out of sync — a single string constant instead of two
// hand-typed copies.
//
// This is the property name the bootstrap attaches its handle under WITHIN the
// isolated world's OWN global object (`window[HANDLE]`). It is unrelated to the
// isolated-world ID itself (see webview-preload.js's VAULT_ENTRY_OBSERVER_WORLD_ID)
// — one names WHICH world, the other names WHERE inside that world's global
// scope the installed controller lives.
const VAULT_ENTRY_OBSERVER_HANDLE = '__goldfinchEntryObserver';

module.exports = { VAULT_ENTRY_OBSERVER_HANDLE };
