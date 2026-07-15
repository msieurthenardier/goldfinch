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
 * @param {number} initial value before either the seed or a push arrives
 */
function createPushCache(initial) {
  let value = initial;
  let pushSeen = false;
  return {
    /** A main push: always wins, marks the seed stale. @param {number} v */
    push(v) {
      pushSeen = true;
      value = v;
    },
    /** The boot-seed invoke's resolve: applies only if no push arrived first. @param {number} v */
    seed(v) {
      if (!pushSeen) value = v;
    },
    /** @returns {number} the cached value */
    get() {
      return value;
    },
  };
}

export { createPushCache };
