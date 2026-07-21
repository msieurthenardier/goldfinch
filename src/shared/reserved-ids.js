// @ts-check
'use strict';

// Reserved-id single source of truth (M12 Flight 3, Leg 1 / DD8).
//
// The literal `'global'` is the vault-store's hard sentinel for the manager-wide
// global vault (vault-store.js's `GLOBAL_ID`) AND a reserved container id in
// jars.js's `isReservedId` (so no user container can mint id `global` and alias a
// jar-scoped vault op onto the shared global vault — cross-vault escalation). Those
// two literals lived independently and could silently drift; this module is their
// single home.
//
// PLAIN CJS BY DESIGN: consumed only main-side (vault-store.js, jars.js,
// register-vault-ipc.js). It is deliberately NOT exported from jars.js — jars.js
// `require`s `./app-db`, and routing the constant through it would couple
// vault-store's Electron-free / app-db-free purity to the app database. A
// dependency-free constant module keeps every consumer pure.

// The global (non-jar) vault's stable id / filename base — the reserved sentinel.
const GLOBAL_ID = 'global';

module.exports = { GLOBAL_ID };
