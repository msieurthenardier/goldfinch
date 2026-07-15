// @ts-check
'use strict';
// Automation print op (DD4). Renders the active web tab to a PDF and returns base64.
// Kept separate from observe.js (flight Technical Approach + DD4) so print concerns
// don't bleed into the read/screenshot module.
const { resolveContents, classifyContents, isInternalContents } = require('./resolve');

// Minimal paint-settle: a not-yet-painted guest can otherwise stall printToPDF.
// Mirrors observe.js's waitForPaint; observe.js does NOT export a shared helper
// (its module.exports lists only ops), so this small local copy is necessary.
// The default ~80ms stays fixed and is intentionally NOT read from print opts —
// keep the paint-wait concern separate from forward-compat print options.
function waitForPaint(_wc, { delayMs = 80 } = {}) {
  return new Promise((r) => setTimeout(r, delayMs));
}

/**
 * Render the active web tab to a PDF, returning base64 (DD4: a plain JSON text
 * string through the default okResult path — NOT an MCP image block; imageResult
 * is PNG-only and there is no application/pdf image type).
 *
 * Foreground-first discipline (mirrors observe.captureScreenshot): resolve →
 * (guest only) activate + re-resolve + wait-for-paint → render. The op-local
 * internal guard (DD3) sits BEFORE activate — refuse internal before foregrounding
 * it (deliberately stricter than evaluate, which guards only the final wc).
 * A single guard is sufficient: the internal-session identity is invariant across
 * re-resolve. admin runs allowInternal:true, so resolveContents alone won't refuse
 * internal — the op-local guard is what excludes it.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents?: any, isChromeContents?: (wc: any) => boolean, allowInternal?: boolean, activate?: (wcId: number) => Promise<void> }} deps
 * @param {object} [_opts] reserved for forward-compat print options (none in v1)
 * @returns {Promise<string>} base64-encoded PDF
 */
async function printToPDF(wcId, deps, _opts = {}) {
  const { chromeContents, isChromeContents, activate } = deps;
  let wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) throw new Error('automation: printToPDF — internal-session excluded');
  if (classifyContents(wc, chromeContents, isChromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);
    wc = resolveContents(wcId, deps); // post-activate stale-handle re-resolve
    await waitForPaint(wc); // fixed default paint-settle
  }
  const buf = await wc.printToPDF({}); // Electron ^42: options arg required
  return buf.toString('base64');
}

module.exports = { printToPDF };
