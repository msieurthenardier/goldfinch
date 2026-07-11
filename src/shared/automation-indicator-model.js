// @ts-check

// Pure decision model for the chrome toolbar's automation ("robot") indicator
// (Flight 3, Leg 6 / HAT inline finding F7 — operator ruling). Extracted so the
// visibility/count/color/rainbow truth table is unit-testable without DOM. Real
// ES module (M07 Flight 2 sweep), the same shape as jar-page-model.js: a real
// `import` of its dependency; consumed via `import` by the chrome controller
// (renderer.js) since leg 5 removed the transitional globalThis bridge.
//
// Operator spec (verbatim): "The robot icon shows up when a connection is
// active. Instead the robot should show whenever at least 1 automation is
// enabled with a count of the enabled jars. The icon should be in the grayed
// out state when not active, but reflect the color of the jar when it is
// active. If the admin key is enabled and active it should be 'rainbow' (if
// possible)."
//
// Interpretation this module encodes:
//   - VISIBILITY: >=1 automation key ENABLED (a minted, non-revoked jar key, or
//     the admin key) — independent of whether any connection is currently live.
//     Zero enabled keys → hidden.
//   - COUNT: the number of ENABLED JAR keys (never admin — "count of the
//     enabled jars" is explicit). Callers hide the count badge at 0 (an
//     admin-only-enabled state still shows the robot, with no jar count).
//   - MODE: 'idle' (visible, no live connection — grayed out) | 'jar' (exactly
//     one distinct active jar, whose color the icon takes) | 'multi' (more than
//     one distinct active jar, OR a single active jar whose color can't be
//     safely resolved — a neutral/accent treatment) | 'admin' (the admin key is
//     both enabled AND currently active — rainbow; trumps any concurrent jar
//     activity).
//   - Multiple simultaneously active connections on DIFFERENT (non-admin) jars
//     is a genuine ambiguity the spec didn't resolve. This module's choice
//     (flagged for operator review at the call site): exactly one distinct
//     active jar → that jar's color; more than one → 'multi' (neutral/accent),
//     NEVER rainbow — rainbow is reserved for the admin tier.
//
// Color resolution is defense-in-depth: a color is only ever returned when the
// active jar is found in the live `containers` list AND its color passes
// isSafeColor (the product's own color domain — the SAME check jars.js /
// container-menu.js / jars page apply before touching styles). A stale/unknown
// jarId or an unsafe color value never throws — it downgrades to 'multi'
// (neutral), matching the "never throw" contract every other shared decision
// module in this codebase holds to.

import { isSafeColor } from './safe-color.js';

/**
 * Resolve the display color for a single active jarId against the live
 * containers list. Returns null (never throws) when the jar is unknown or its
 * stored color fails isSafeColor.
 * @param {string} jarId
 * @param {Array<{ id?: any, color?: any }> | null | undefined} containers
 * @returns {string | null}
 */
function resolveJarColor(jarId, containers) {
  const jar = (containers || []).find((c) => c && c.id === jarId);
  if (!jar || typeof jar.color !== 'string') return null;
  return isSafeColor(jar.color) ? jar.color : null;
}

/**
 * Build the automation indicator's render model from live automation state.
 * Pure — no DOM, no Electron. Never throws on malformed input (defensive
 * defaults + a stale/unknown jarId or unsafe color both downgrade to 'multi'
 * rather than propagate).
 *
 * @param {{
 *   enabledJarKeyCount?: number,
 *   adminKeyEnabled?: boolean,
 *   activeJarIds?: Array<string | null | undefined>,
 *   adminActive?: boolean,
 *   containers?: Array<{ id?: any, color?: any }>,
 * }} input
 * @returns {{
 *   visible: boolean,
 *   count: number,
 *   mode: 'idle' | 'jar' | 'multi' | 'admin',
 *   color: string | null,
 * }}
 */
export function buildAutomationIndicatorModel(input) {
  const opts = input || {};
  const jarKeyCount = Number.isInteger(opts.enabledJarKeyCount) && opts.enabledJarKeyCount > 0
    ? opts.enabledJarKeyCount
    : 0;
  const adminKeyEnabled = !!opts.adminKeyEnabled;
  const visible = jarKeyCount > 0 || adminKeyEnabled;

  if (!visible) {
    return { visible: false, count: 0, mode: 'idle', color: null };
  }

  // Admin trumps everything else, but only when the admin key is BOTH enabled
  // and currently active — a stray adminActive with no enabled admin key
  // (shouldn't happen; a live admin session implies a valid key) falls through
  // to the jar/multi/idle resolution below rather than rendering rainbow.
  if (adminKeyEnabled && opts.adminActive) {
    return { visible: true, count: jarKeyCount, mode: 'admin', color: null };
  }

  const distinctActive = [...new Set(
    (opts.activeJarIds || []).filter((id) => typeof id === 'string' && id)
  )];

  if (distinctActive.length === 1) {
    const color = resolveJarColor(distinctActive[0], opts.containers);
    if (color) return { visible: true, count: jarKeyCount, mode: 'jar', color };
    // Stale/unknown jarId or an unsafe stored color — neutral, never throw.
    return { visible: true, count: jarKeyCount, mode: 'multi', color: null };
  }

  if (distinctActive.length > 1) {
    return { visible: true, count: jarKeyCount, mode: 'multi', color: null };
  }

  return { visible: true, count: jarKeyCount, mode: 'idle', color: null };
}
