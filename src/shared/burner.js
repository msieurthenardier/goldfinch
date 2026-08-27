// @ts-check

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
//
// Real ES module (M07 Flight 2 pilot): `export const` for module consumers
// (import in container-menu.js / jar-page-model.js and the page controllers
// renderer.js / pages/jars.js; require(esm) in main-process code and the test
// runner). The transitional globalThis bridge was removed in leg 5 when the
// page controllers converted.

export const BURNER = Object.freeze({ id: 'burner', name: 'Burner', color: '#ff8c42' });

// Squawk 0036 (#104 carve-out): burner session partitions are pinned as
// `burner:<n>` — colon separator, no `persist:` prefix (see the shape table in
// inherit-container.js) — so this is a pure string check, not a new identity
// concept. The smallest shared hook for the two burner-only WebRTC
// IP-handling-policy call sites (register-tab-ipc.js's tab-create web branch,
// guest-wiring.js's popup did-create-window path): both must agree on what
// counts as "the burner branch" without duplicating the pinned format.
export function isBurnerPartition(partition) {
  return typeof partition === 'string' && partition.startsWith('burner:');
}
