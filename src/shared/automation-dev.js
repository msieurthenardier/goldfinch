// @ts-check
'use strict';
// Dev gates for the automation surface.
//   - isMcpAutomationEnabled — the MCP-transport dev gate (DD4): true ONLY for `--automation-dev`.
//     Read both in the MAIN process (to gate the MCP server + the dev seam) and surfaced to the
//     chrome renderer via additionalArguments (`--automation-dev` injected into the renderer argv).
// Pure; never throws. The legacy browser-process CDP debugging dev gate was removed in F9 along with
// the ungated CDP debugging path; `--automation-dev` is the sole dev-automation switch.
// PRELOAD-REACHABLE (flight-02 divert constraint): required by chrome-preload.js via the RENDERER
// process's Node require, which has no require(esm) support — this module must stay CJS and must
// never require a converted ESM module (resolveAutoMintTarget moved to src/main/auto-mint.js for
// exactly this reason: it requires the ESM burner.js).

/**
 * Returns true iff argv carries the EXACT `--automation-dev` token — the MCP-transport dev gate
 * (DD4). It is the SOLE dev-automation switch (the legacy CDP debugging gate was removed in F9), and
 * is structurally independent of any browser-process debugging switch. `--automation-dev` is read
 * here in the MAIN process and is also injected into the chrome renderer's argv via
 * additionalArguments so the renderer can gate its dev seam the same way.
 *
 * False for any non-array input, an empty array, or when the exact token is absent (a prefix like
 * `--automation-dev-extra` does not match).
 *
 * @param {unknown} argv  typically process.argv
 * @returns {boolean}
 */
function isMcpAutomationEnabled(argv) {
  return Array.isArray(argv) && argv.includes('--automation-dev');
}

/**
 * Returns true iff the env-gated dev auto-mint affordance should fire. DEV-ONLY: it is the
 * double-gate predicate behind the auto-mint-to-stdout block in main.js (Flight 4, Leg 5). Both
 * gates must hold:
 *   1. isMcpAutomationEnabled(argv) — i.e. the EXACT `--automation-dev` token (so it can never run
 *      in a shipped build, which never carries that flag).
 *   2. env.GOLDFINCH_AUTOMATION_DEV_MINT === '1' — strict equality against the literal '1', so a
 *      plain `npm run dev:automation` (no env var) stays inert and off-by-default remains observable.
 *
 * Pure; never throws. Admin minting is a SEPARATE, narrower gate (GOLDFINCH_AUTOMATION_ADMIN) checked
 * by the caller / mintAdminKey — it is intentionally NOT folded in here.
 *
 * @param {unknown} argv  typically process.argv
 * @param {Record<string, string | undefined> | undefined} env  typically process.env
 * @returns {boolean}
 */
function shouldAutoMint(argv, env) {
  return isMcpAutomationEnabled(argv) && !!env && env.GOLDFINCH_AUTOMATION_DEV_MINT === '1';
}

/**
 * Returns true iff the MCP automation surface should bind. DD2 (Flight 8): the human
 * `automationEnabled` toggle is the SOLE bind gate in production — bind iff it is on.
 * The `devForceBind` term keeps a dev launch binding regardless of the persisted toggle
 * (leg 2 passes `isMcpAutomationEnabled(process.argv)` here to preserve today's dev harness;
 * leg 3 swaps that for the `!app.isPackaged`-gated in-memory dev-enable override). Pure so
 * the launch gate and the leg-3 override compose from one unit-tested rule.
 *
 * Strict-equality checks (`=== true`) so only the genuine boolean true binds — never a
 * truthy non-boolean.
 *
 * @param {{ automationEnabled?: unknown, devForceBind?: unknown }} [opts]
 * @returns {boolean}
 */
function shouldBindAutomation({ automationEnabled, devForceBind } = {}) {
  return automationEnabled === true || devForceBind === true;
}

module.exports = { isMcpAutomationEnabled, shouldAutoMint, shouldBindAutomation };
