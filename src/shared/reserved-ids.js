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

/**
 * The reserved identity names: ids no jar may hold and no automation key may be
 * stored under. `burner` / `burner-*` are renderer-only, `admin` is the admin
 * tier's identity, `internal` is the internal-page jar, `default` the legacy
 * default, and `global` the manager-wide vault. ONE predicate — jars.js (jar ids),
 * the settings store (strip + validator), `validateKey`, `mintJarKey` and the
 * chrome's key state all call it, so they cannot drift apart.
 * @param {unknown} id
 * @returns {boolean}
 */
function isReservedId(id) {
  return (
    typeof id === 'string' &&
    (id === 'burner' ||
      id.startsWith('burner-') ||
      id === 'admin' ||
      id === 'internal' ||
      id === 'default' ||
      id === GLOBAL_ID)
  );
}

/**
 * A name that may NOT be an automation key-map entry: every reserved identity,
 * plus the two names that are not an ordinary own entry on a plain object
 * (`hashes['__proto__'] = …` sets the prototype). Stricter than `isReservedId`
 * on purpose — a jar id may legitimately never be either, but this predicate
 * guards a map, not a jar list.
 * @param {unknown} name
 * @returns {boolean}
 */
function isReservedKeyName(name) {
  return isReservedId(name) || name === '__proto__' || name === 'constructor';
}

module.exports = { GLOBAL_ID, isReservedId, isReservedKeyName };
