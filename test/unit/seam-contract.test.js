'use strict';

// DD3b — renderer evaluate-seam ⊇ a11y-audit-driven-set contract (flight 03,
// leg 2 / F2 debrief Rec 3). scripts/a11y-audit.mjs drives renderer functions
// by NAME through evaluate(client, wcId, '<name>(...)') calls (chrome
// state-drivers) and via the SHEET_STATES table's `open:` string literals
// (sheet state-drivers) — both paths only work if the named function is
// republished on globalThis by the seam block at the tail of
// src/renderer/renderer.js (see CLAUDE.md "Renderer evaluate-seam closed-set
// rule"). The seam is a CLOSED SET of exactly 21 FD-approved entries (M09
// Flight 5 Leg 1 added openTabContextMenuForAudit for the sheet:tab-context
// a11y state; M11 Flight 1 Leg 3 added showDownloadsIndicatorForAudit +
// openDownloadsOverlayForAudit for the downloads-button + sheet:downloads
// a11y states — see the respective flights' Checkpoints).
//
// This test statically parses BOTH files as text — no boot, no vm execution
// — and asserts every audit-driven identifier is present in the seam, so a
// drift (an a11y-audit call to a name the seam doesn't republish) fails in
// the suite instead of at a live `npm run a11y` run.
//
// If this fails legitimately because the SEAM GREW: that requires an FD
// ruling (CLAUDE.md) — update the SEAM_COUNT constant here AND CLAUDE.md
// together, don't just bump this pin. If it fails because a11y-audit.mjs
// added a new evaluate()/open: call to a name the seam doesn't have: that is
// a real bug — either add the entry to the seam (FD ruling required) or fix
// the audit script.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const RENDERER_JS = path.join(REPO_ROOT, 'src/renderer/renderer.js');
const A11Y_AUDIT_MJS = path.join(REPO_ROOT, 'scripts/a11y-audit.mjs');

// The FD-approved closed-set size (CLAUDE.md "Renderer evaluate-seam
// closed-set rule"). Growing the seam requires an FD ruling AND this
// constant's update — enforcement by design (AC4).
const SEAM_COUNT = 21;

const SEAM_ANCHOR = 'Object.assign(/** @type {any} */ (globalThis), {';
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

// ---------------------------------------------------------------------------
// Seam extraction (AC3/AC5, pure in-file). Locates the unique seam-block
// anchor (asserting exactly one occurrence — a second globalThis
// Object.assign in the file is itself drift worth failing on), takes the
// text up to the block's closing `});`, and returns the identifier list —
// stripping trailing `//` comments (5 seam entries carry them, incl. leg-1's
// `openContainerOverlay` tag) and full-line `//` group-header comments (3
// consumer-class headers) in the same pass.
// ---------------------------------------------------------------------------
function extractSeamIdentifiers(rendererSource) {
  const occurrences = rendererSource.split(SEAM_ANCHOR).length - 1;
  assert.equal(
    occurrences,
    1,
    `expected exactly one seam anchor in renderer.js, found ${occurrences} — a second globalThis ` +
      'Object.assign is itself drift worth failing on'
  );
  const start = rendererSource.indexOf(SEAM_ANCHOR) + SEAM_ANCHOR.length;
  const end = rendererSource.indexOf('});', start);
  assert.ok(end !== -1, 'seam block closing "});" not found after the anchor');
  const block = rendererSource.slice(start, end);

  const identifiers = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const commentIdx = rawLine.indexOf('//');
    const codePart = (commentIdx === -1 ? rawLine : rawLine.slice(0, commentIdx)).trim().replace(/,\s*$/, '');
    if (IDENTIFIER_RE.test(codePart)) identifiers.push(codePart);
  }
  return identifiers;
}

// ---------------------------------------------------------------------------
// Audit extraction, two-tier (AC3, pure in-file):
//   tier 1 — direct evaluate(client, wcId, '<name>(...)') literal /
//            template-literal call sites (6 identifiers live today).
//   tier 2 — the SHEET_STATES table's `open: '<name>(...)'` string literals
//            (5 identifiers live today) — invoked indirectly via
//            evaluate(client, wcId, state.open), so tier 1 alone recovers
//            only ~half the real audit surface (probe-verified: 6/11).
// ---------------------------------------------------------------------------
function extractAuditTier1(auditSource) {
  const re = /evaluate\(\s*client,\s*wcId,\s*['"`]([A-Za-z_$][\w$]*)\(/g;
  const out = [];
  let m;
  while ((m = re.exec(auditSource))) out.push(m[1]);
  return out;
}

function extractAuditTier2(auditSource) {
  const re = /open:\s*'([A-Za-z_$][\w$]*)\(/g;
  const out = [];
  let m;
  while ((m = re.exec(auditSource))) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Contract check (pure in-file): every audit-driven identifier must be
// present in the seam set. Returns the (possibly empty) list of misses so
// callers can build a helpful failure message.
// ---------------------------------------------------------------------------
function findAuditIdentifiersMissingFromSeam(auditIdentifiers, seamIdentifiers) {
  const seamSet = new Set(seamIdentifiers);
  return [...new Set(auditIdentifiers)].filter((id) => !seamSet.has(id));
}

// ---------------------------------------------------------------------------
// AC3/AC4 — the live pin, against the real files.
// ---------------------------------------------------------------------------
test('seam-contract: a11y-audit-driven identifiers are a subset of the renderer evaluate-seam', () => {
  const rendererSource = fs.readFileSync(RENDERER_JS, 'utf8');
  const auditSource = fs.readFileSync(A11Y_AUDIT_MJS, 'utf8');

  const seamIdentifiers = extractSeamIdentifiers(rendererSource);
  assert.equal(
    seamIdentifiers.length,
    SEAM_COUNT,
    `expected exactly ${SEAM_COUNT} seam entries (the FD-approved closed set), found ` +
      `${seamIdentifiers.length}: ${JSON.stringify(seamIdentifiers)} — growing the seam requires an FD ruling ` +
      "AND this pin's SEAM_COUNT update"
  );

  const tier1 = extractAuditTier1(auditSource);
  const tier2 = extractAuditTier2(auditSource);

  // Anti-vacuous lower bounds (AC4): a regex drifting to zero matches must
  // fail loudly, not silently pass an empty-subset check. Lower bounds, not
  // exact counts, so ADDING an audit state that also lands in the seam does
  // not break this suite.
  assert.ok(
    tier1.length >= 6,
    `expected at least 6 tier-1 (direct evaluate literal) identifiers, found ${tier1.length}`
  );
  assert.ok(
    tier2.length >= 5,
    `expected at least 5 tier-2 (SHEET_STATES open:) identifiers, found ${tier2.length}`
  );

  const missing = findAuditIdentifiersMissingFromSeam([...tier1, ...tier2], seamIdentifiers);
  assert.deepEqual(
    missing,
    [],
    `a11y-audit.mjs drives ${JSON.stringify(missing)} via evaluate(), but the renderer.js seam block does not ` +
      'republish it — either add it to the seam (FD ruling required) or fix the audit script'
  );
});

// ---------------------------------------------------------------------------
// AC5 — extraction helpers are pure and truth-table tested independent of
// the live files, including the violation case (an audit-driven identifier
// absent from a synthetic seam is detected) — this doubles as the permanent
// in-suite CP2 fail-on-violation demonstration for the seam-contract test
// (AC6b).
// ---------------------------------------------------------------------------
test('extractSeamIdentifiers — truth table (trailing comments, group headers)', () => {
  const synthetic = `${SEAM_ANCHOR}
  // dogfooding group header
  openJarsPage,
  createTab, // trailing comment, comma before
  makeBurner,
  // another group header
  openFind // trailing comment, no comma (last entry)
});`;
  assert.deepEqual(extractSeamIdentifiers(synthetic), ['openJarsPage', 'createTab', 'makeBurner', 'openFind']);
});

test('extractSeamIdentifiers — throws on zero or multiple anchor occurrences', () => {
  assert.throws(() => extractSeamIdentifiers('no anchor here'));
  const twoAnchors = `${SEAM_ANCHOR}\n  a\n});\n${SEAM_ANCHOR}\n  b\n});\n`;
  assert.throws(() => extractSeamIdentifiers(twoAnchors));
});

test('extractAuditTier1 — truth table (literal/template-literal call sites only)', () => {
  const synthetic = `
    await evaluate(client, wcId, 'togglePanel(true)');
    await evaluate(client, wcId, \`openLightbox({ url: \${x} })\`);
    await evaluate(client, wcId, "applyToolbarPins({})");
    await evaluate(client, wcId, expr); // variable — must NOT match
    await evaluate(client, wcId, state.open); // property access — must NOT match
    async function evaluate(client, wcId, expression) {} // definition — must NOT match
  `;
  assert.deepEqual(extractAuditTier1(synthetic), ['togglePanel', 'openLightbox', 'applyToolbarPins']);
});

test('extractAuditTier2 — truth table (SHEET_STATES open: literals only)', () => {
  const synthetic = `
    const SHEET_STATES = [
      { label: 'sheet:kebab', open: 'openKebabOverlay(0)' },
      { label: 'sheet:container', open: 'openContainerOverlay(0)' }
    ];
    console.log(state.open); // property access — must NOT match
  `;
  assert.deepEqual(extractAuditTier2(synthetic), ['openKebabOverlay', 'openContainerOverlay']);
});

test('findAuditIdentifiersMissingFromSeam — violation case: an audit identifier absent from a synthetic seam is detected', () => {
  const seam = ['togglePanel', 'openLightbox'];
  const audit = ['togglePanel', 'openLightbox', 'notInSeam'];
  assert.deepEqual(findAuditIdentifiersMissingFromSeam(audit, seam), ['notInSeam']);
});

test('findAuditIdentifiersMissingFromSeam — no violation when audit is a subset of seam', () => {
  const seam = ['togglePanel', 'openLightbox', 'extraSeamOnlyEntry'];
  const audit = ['togglePanel', 'openLightbox'];
  assert.deepEqual(findAuditIdentifiersMissingFromSeam(audit, seam), []);
});
