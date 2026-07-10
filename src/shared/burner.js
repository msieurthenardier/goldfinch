// @ts-check
'use strict';

// Burner identity constant (M06 Flight 1 / DD4). The Burner is a shared frozen
// identity, NEVER a jars.js store entry — three subsystems depend on burner ∉
// jars.list(): the automation mint guard (mcp-server.js refuses burner ids because
// they're not listed), jar-scoped enumeration (scope.js drops burners by session
// identity), and the container picker (container-menu.js renders the burner
// sentinel separately — a listed burner would render twice). Management surfaces
// compose `jars.list() + BURNER` themselves.
//
// The id namespace `burner` / `burner-*` is RESERVED: jars.js remaps saved entries
// claiming it and mint-time slugs into it (prefix `jar-`), so a user jar named
// "Burner" can never collide with the ephemeral burner-tab ids the renderer mints
// (`makeBurner()` → `burner-<n>`).
//
// container-menu.js (the burner sentinel) and renderer.js:makeBurner both derive
// name/color from this constant (M06 Flight 2 Leg 1, DD8) — the prior triplication
// of the color literal below is retired.

const BURNER = Object.freeze({ id: 'burner', name: 'Burner', color: '#ff8c42' });

// Dual export: CommonJS (main process + test runner) and global (renderer-class
// documents, which run with nodeIntegration:false and cannot require()).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BURNER };
} else {
  /** @type {any} */ (globalThis).BURNER = BURNER;
}
