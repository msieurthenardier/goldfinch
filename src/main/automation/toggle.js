// @ts-check
'use strict';

// Automation toggle — the serialized core that drives the live MCP automation
// surface ON/OFF and the live port-rebind (Flight 9, Leg 7 / DD8(a)).
//
// This module is deliberately ELECTRON-FREE (no require('electron')) so it can be
// unit-tested offline with fakes. It is NOT a parallel copy of main.js's logic: it
// IS the production serialization path. main.js's applyAutomationEnabledChange and
// rebindMcpServer become thin delegators into the factory built here.
//
// WHY this module exists: main.js is not unit-reachable (no module.exports; it calls
// protocol.registerSchemesAsPrivileged at module load, which the electron-stub does
// not provide). The serializable core is extracted here so the race fix can be tested
// against the exact code path the app runs.
//
// THE RACE (F8 debrief): applyAutomationEnabledChange awaited the rebind chain but
// NOT a second applyAutomationEnabledChange caller. Two rapid flip-ONs both saw
// mcpServer===null and both started a server → EADDRINUSE; an OFF-after-OFF silently
// no-oped. The fix: ONE in-flight promise chain that BOTH applyEnabledChange and
// rebind await-then-extend (a single mutex, not two independent locks).

/**
 * Build the serialized automation toggle. `applyEnabledChange` and `rebind` share
 * ONE `inFlight` closure via `runSerialized`, so a concurrent flip + flip, flip +
 * rebind, or rebind + rebind cannot interleave their stop()/start() pairs.
 *
 * The injected deps mediate the module-scoped MCP server handle and status that
 * live in main.js: `getServer`/`setServer` read/write the `mcpServer` variable;
 * `start`/`stop` are startMcpServerInstance / mcpServer.stop(); `isDevOverride`
 * reads the dev-enable override; `setStatus` writes the disabled mcpStatus on a
 * production flip-OFF teardown.
 *
 * @param {{
 *   start: () => Promise<void>,
 *   stop: () => Promise<void>,
 *   getServer: () => any,
 *   setServer: (server: any) => void,
 *   isDevOverride: () => boolean,
 *   setStatus: (status: any) => void,
 * }} deps
 * @returns {{ applyEnabledChange: (enabled: boolean) => Promise<void>, rebind: () => Promise<void> }}
 */
function makeAutomationToggle({ start, stop, getServer, setServer, isDevOverride, setStatus }) {
  // ONE chain for BOTH paths (replaces main.js's old `rebinding` variable).
  let inFlight = null;

  // Serialize `body` after any prior op. The serialization await tolerates a prior
  // REJECTION (.catch) so a failed op does not wedge the chain for the NEXT op; the
  // op's own body still surfaces its own error to its own caller. The identity guard
  // in finally avoids clearing inFlight when a later op has already extended it.
  function runSerialized(body) {
    const prior = inFlight;
    const mine = (async () => { await Promise.resolve(prior).catch(() => {}); return body(); })();
    inFlight = mine;
    return (async () => { try { return await mine; } finally { if (inFlight === mine) inFlight = null; } })();
  }

  /**
   * Drive the live surface to match the persisted `automationEnabled` toggle.
   * Body moved VERBATIM from main.js's applyAutomationEnabledChange (only the
   * top-of-function `if (rebinding) await rebinding` guard is dropped — runSerialized
   * replaces it). Flip-ON: start from null (guarded no-op if already bound). Flip-OFF:
   * dev-override early-return keeps the surface bound (DD3/DD4); otherwise teardown +
   * status reset.
   * @param {boolean} enabled
   */
  function applyEnabledChange(enabled) {
    return runSerialized(async () => {
      if (enabled) {
        // Start-from-null on a cold flip-ON (a packaged build launches with the
        // server null). Already bound (e.g. a dev launch force-bound) → guarded
        // no-op, no double-bind.
        if (!getServer()) await start();
      } else {
        // DD3/DD4 flip-OFF guard: when the dev-enable override is active, KEEP the
        // surface bound even though the persisted toggle just went off. The caller
        // (`internal-settings-set`) persists automationEnabled=false FIRST, then calls
        // this — so returning early here yields the persisted-off + surface-live state
        // that automation-key-gating exercises in dev. In production the override is
        // false, so flip-OFF falls through to teardown.
        if (isDevOverride()) return;
        // Stop-and-stay-stopped: tear the listener + all sessions down and reset
        // status to disabled so a later rebind/launch does not resurrect the surface.
        const server = getServer();
        if (server) {
          await server.stop();
          setServer(null);
        }
        setStatus({ enabled: false, host: '127.0.0.1', port: null, bound: false, error: null });
      }
    });
  }

  /**
   * Live-rebind the running surface to the current resolved port. No-op when the
   * surface is not active. stop() then start() (start re-runs resolvePort, so a
   * newly-saved port applies live). Body error semantics preserved: a stop()
   * rejection fails THIS op (surface stays as-is) exactly as before; the serialization
   * .catch only isolates the NEXT op from this op's rejection.
   */
  function rebind() {
    return runSerialized(async () => {
      if (!getServer()) return; // surface not active — nothing to rebind
      await stop();
      await start();
    });
  }

  return { applyEnabledChange, rebind };
}

module.exports = { makeAutomationToggle };
