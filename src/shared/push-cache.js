// @ts-check

// Seed/push race cache (M09 Flight 6, DD6) — the renderer-side cache for a
// main-pushed value that also has a boot-seed invoke. Race rule (flight design
// review L1): a received PUSH always wins; the SEED applies only if no push has
// arrived — monotonic by ARRIVAL, not by value. The push is the fresher fact
// even when the numbers disagree: a mutation broadcast can land before the boot
// invoke's (older) snapshot resolves, and the seed must not clobber it.
//
// Pure ES module (the tab-context-model precedent): no DOM, no bridge — the
// renderer wires `push` to the main→chrome subscription and `seed` to the boot
// invoke's resolve.

/**
 * GENERIC over the cached value since M09 F8 Leg 4 (DD8), which caches the
 * `{ windowId, label }[]` move-target list through this same seed/push race. The
 * BEHAVIOR is unchanged — arrival-monotonic, push-always-wins — and stays pinned
 * by push-cache.test.js; only the JSDoc widened, because a `number`-typed cache
 * cannot hold an array and the typecheck gate says so.
 *
 * @template T
 * @param {T} initial value before either the seed or a push arrives
 */
function createPushCache(initial) {
  let value = initial;
  let pushSeen = false;
  return {
    /** A main push: always wins, marks the seed stale. @param {T} v */
    push(v) {
      pushSeen = true;
      value = v;
    },
    /** The boot-seed invoke's resolve: applies only if no push arrived first. @param {T} v */
    seed(v) {
      if (!pushSeen) value = v;
    },
    /** @returns {T} the cached value */
    get() {
      return value;
    },
  };
}

export { createPushCache };
