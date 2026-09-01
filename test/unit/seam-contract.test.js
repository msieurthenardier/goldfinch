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
const BOOKMARKS_BAR_JS = path.join(REPO_ROOT, 'src/renderer/chrome/bookmarks-bar.js');
const A11Y_AUDIT_MJS = path.join(REPO_ROOT, 'scripts/a11y-audit.mjs');

// The FD-approved closed-set size (CLAUDE.md "Renderer evaluate-seam
// closed-set rule"). Growing the seam requires an FD ruling AND this
// constant's update — enforcement by design (AC4).
// M11 F1 Leg 3 (downloads popup, FD ruling): +2 for showDownloadsIndicatorForAudit /
// openDownloadsOverlayForAudit — the 'downloads-button' chrome state + SHEET_STATES
// 'sheet:downloads' a11y drivers (the M09 F5 openTabContextMenuForAudit precedent).
// M12 F3 Leg 4 (first-run-setup, DD9): +2 for openVaultSetOverlayForAudit /
// openVaultRecoveryShowOverlayForAudit — the SHEET_STATES 'sheet:vault-set' /
// 'sheet:vault-recovery-show' a11y drivers (a leg-authorized seam addition, the M09 F5
// openTabContextMenuForAudit precedent).
// M12 F3 Leg 5 (access-keys, DD9): +2 for openVaultStepupOverlayForAudit /
// openVaultAccessKeyShowOverlayForAudit — the SHEET_STATES 'sheet:vault-stepup' /
// 'sheet:vault-accesskey-show' a11y drivers (same leg-authorized seam-addition precedent).
// M12 F4 Leg 1 (export-import, DD9): +1 for openVaultImportUnlockOverlayForAudit — the
// SHEET_STATES 'sheet:vault-import-unlock' a11y driver (same leg-authorized seam-addition
// precedent).
// M12 F4 Leg 2 (key-rotation, DD9): +2 for openVaultChangeMasterOverlayForAudit /
// openVaultRecoverOverlayForAudit — the SHEET_STATES 'sheet:vault-change-master' /
// 'sheet:vault-recover' a11y drivers (same leg-authorized seam-addition precedent).
// M12 F4 Leg 3 (admin-key-provision, DD9): +1 for openVaultAdminKeyShowOverlayForAudit — the
// SHEET_STATES 'sheet:vault-adminkey-show' a11y driver (same leg-authorized seam-addition precedent).
// M14 F1 L2 (auth-challenges): +1 for openAuthBasicOverlayForAudit — the SHEET_STATES
// 'sheet:auth-basic' a11y driver for the new HTTP basic-auth credential sheet (same
// leg-authorized seam-addition precedent; a planned, deliberate bump per the flight's
// Technical Approach).
// M14 F1 L3 (client-cert): +1 for openCertPickerOverlayForAudit — the SHEET_STATES
// 'sheet:cert-picker' a11y driver for the TLS client-certificate chooser sheet (same
// leg-authorized seam-addition precedent; planned bump per the leg's Outputs).
// M15 F1 Leg 2 (bookmarking, FD ruling): +1 for openBookmarkEditOverlayForAudit —
// the SHEET_STATES 'sheet:bookmark-edit' a11y driver for the star/bar/overflow
// quick-edit popover (the every-new-sheet precedent, explicitly FD-ruled in the
// leg's Context: "the evaluate-seam closed set MAY grow by exactly one entry this
// leg").
// M15 F1 Leg 3 (bookmarking, FD ruling): +1 for openBookmarksOverflowOverlayForAudit —
// the SHEET_STATES 'sheet:bookmarks-overflow' a11y driver for the overflow chevron
// menu (same every-new-sheet precedent, FD-ruled in the leg's Context).
// M15 F2 Leg 1 (renderer-extraction): NO membership change — the eight
// openVault*OverlayForAudit entries above are pure relocations, now imported
// from the new src/renderer/chrome/vault-controller.js and destructured into
// bare renderer.js consts so this parser's IDENTIFIER_RE still matches them.
// M16 F2 Leg 1 (welcome-home-routing, FD ruling): +1 for openNewTab — NOT an
// a11y-audit-driven identifier (it adds no chrome/sheet state); the FD ruling
// is that welcome-home-routing's behavior-spec step 5 needs the burner path
// to run through the same evaluate-reachable entry point the container-menu
// dispatch already uses, which this closed set otherwise has no seam for.
// M18 F2 L4 (compromise-mode rotation, DD4/DD9): +2 for
// openVaultCompromiseOverlayForAudit / openVaultCompromiseRecoverOverlayForAudit — the
// SHEET_STATES 'sheet:vault-compromise' / 'sheet:vault-compromise-recover' a11y drivers
// (same leg-authorized seam-addition precedent as the other vault sheets).
const SEAM_COUNT = 36;
// Renderer line budget: raised from M11's 1200 to absorb Mission 12's password-manager
// renderer work (the chrome-owned vault sheets + indicator wiring). See the merge of
// PR #112; renderer.js extraction remains banked architecture debt.
// Mission 13 F1 Leg 2 (DD2/AC3): +1 for the toMediaProxyUrl import + createMediaController
// dep-injection line (media-panel proxy wiring) — the minimum single-line footprint for a
// new shared dependency; no other renderer.js growth in this leg.
// M14 F1 L2 (auth-challenges): +34 (1700 → 1734) for the auth-basic sheet's chrome
// wiring — overlay state entry, auth-challenge-present open listener, channel-6
// validated-no-op branch, and the openAuthBasicOverlayForAudit seam hook — the
// minimum per-sheet chrome footprint (vault-sheet precedent). Planned, deliberate
// bump per the flight's Technical Approach; renderer.js extraction remains banked
// architecture debt. (Budget counts split-array elements — one above `wc -l` for a
// newline-terminated file, matching the prior 1700/1701 pairing.)
// M14 F1 L3 (client-cert): +31 (1734 → 1765) for the cert-picker sheet's chrome
// wiring — overlay state entry, cert-challenge-present open listener, channel-6
// validated-no-op branch, the openCertPickerOverlayForAudit seam hook, and the
// seam-block bookkeeping — the same minimum per-sheet chrome footprint as L2's
// auth-basic bump. Planned, deliberate bump per the leg's Outputs; renderer.js
// extraction remains banked architecture debt.
// M15 F1 Leg 2 (bookmarking, FD ruling): +100 (1766 → 1866) — the star/bar/
// overflow quick-edit popover's residual renderer.js footprint: the
// bookmark-edit overlay-state entry (fixedTriggerMenu(() => els.star)), the
// anchored-open + shared star-activation glue (openBookmarkEditOverlay /
// handleBookmarkStarActivate — the sheet-opening half can't move into
// bookmarks-client.js, which owns no sheet/anchor machinery), the
// dispatchOverlayActivation 'bookmark-edit' stub case + the page-context
// 'action:bookmark-page' branch, the bookmarksClient construction + boot-race
// join, the five star-sync call sites (2 land in renderer.js;
// tab-controller.js/navigation-controller.js absorb the rest), the DD6 icon
// passive-refresh line in onTabFavicon, the star trigger + bookmark-edit-submit
// subscriber wiring, and the seam hook — bookmark BUSINESS logic (the cache,
// activateStar's decision, the edit-submit forward body) lives in the new
// bookmarks-client.js per the leg's own line-budget ruling, not here. Planned,
// deliberate bump per the leg's Context FD ruling; renderer.js extraction
// remains banked architecture debt.
// M15 F1 Leg 3 (bar/settings/overflow, FD ruling — second minimal bump,
// conditional on bar/overflow logic living in bookmarks-bar.js): +67
// (1866 → 1933) — the bar/overflow's residual renderer.js footprint: the
// 'bookmarks-overflow' overlay-state entry (fixedTriggerMenu(() =>
// els.bookmarksOverflow)), the bookmarksBarController construction + its
// boot-race render() join, the extended single onChanged closure (bar
// re-render + DD9 overflow stale-close — no independent
// onBookmarksChanged subscriber), the dispatchOverlayActivation
// 'bookmarks-overflow' case, the parameterized openBookmarkEditOverlay
// anchor (leg-2 code, small refactor), the sendActiveBounds dep threaded
// into window-controller.js's construction, and the seam hook — ALL
// bar/overflow rendering, measurement, and dispatch business logic lives in
// the new bookmarks-bar.js per the leg's own line-budget ruling, not here.
// Planned, deliberate bump per the leg's Context FD ruling; renderer.js
// extraction remains banked architecture debt.
// M15 F2 Leg 1 (renderer-extraction, FD ruling — the banked architecture debt
// finally paid): REBASED DOWNWARD, 1933 → 1650. The entire vault flow (11
// overlay-state entries, the flow state machine + its five state variables,
// openVaultPicker/openCaptureSheet/renderVaultIndicator, every
// window.goldfinch.onVault* subscription, the vault-picker activation dispatch
// + the three show/ack no-op dispatch cases, the vault-unlock/vault-capture
// overlay-close branches, and the eight vault *ForAudit seam hooks) moved to
// the new src/renderer/chrome/vault-controller.js, built on the
// createDownloadsController shape (chained handleActivation/handleClosed,
// late-bound openOverlayMenu). renderer.js measures 1527 by this test's own
// metric post-extraction; the budget is set to measured + ~123 headroom
// (rounded to a clean number, ≤ 1700 per the leg's Outputs) for legs 2-3's
// planned jar-scoped bookmark call-site growth in this same flight.
// Re-based 2026-08-27 (Flight 5, Prettier adoption): 1650 → 1827. Prettier's
// whole-tree reformat under the existing .prettierrc (singleQuote,
// trailingComma: none, printWidth: 120) expands one-line function bodies to
// three lines and splits over-width import/dependency lists one per line,
// growing the file. The budget is set to the file's measured post-format
// line count by this test's own metric (source.split(/\r?\n/).length) —
// zero headroom, same zero-headroom policy the pre-format 1650 carried.
// +1 for the DD7 findTabByWcId dep (M17 F1 L2, 2026-08-28).
// M18 F2 L4 (compromise-mode rotation): +7 (1828 → 1835) for the two compromise
// a11y seam hooks — the destructure lines, the two seam entries, and the seam-block
// comment note — the minimum per-sheet renderer.js footprint (the vault-controller
// owns all the flow wiring). Planned, deliberate bump per the leg's registry-join
// deliverable; zero headroom, same policy as the Prettier re-base.
const RENDERER_LINE_BUDGET = 1835;

// Bookmarks-bar line budget (squawk 0025, M15 debrief finding F25): bar/
// overflow rendering, measurement, and dispatch business logic lives in
// bookmarks-bar.js per the M15 F1 Leg 3 line-budget ruling above — this pin
// gives that file the same drift protection RENDERER_LINE_BUDGET gives
// renderer.js. bookmarks-bar.js measures 1047 by this test's own
// split-array metric (one above `wc -l` for a newline-terminated file, same
// counting convention as RENDERER_LINE_BUDGET); the budget is set to
// measured + 53 headroom, rounded to a clean number (1100), a small buffer
// for incidental drift rather than planned feature growth — no bar/overflow
// work is scheduled. This pin protects the drag-session/render extraction
// seam (bookmarks-bar.js owns both concerns today) until that split
// happens; if it fails legitimately because the split is landing, raise
// the budget as part of that leg rather than bumping it in isolation.
const BOOKMARKS_BAR_LINE_BUDGET = 1100;

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

test('renderer.js remains a thin composition root within its RENDERER_LINE_BUDGET line budget', () => {
  const source = fs.readFileSync(RENDERER_JS, 'utf8');
  const lines = source.split(/\r?\n/).length;
  assert.ok(lines <= RENDERER_LINE_BUDGET, `renderer.js has ${lines} lines; budget is ${RENDERER_LINE_BUDGET}`);
});

test('bookmarks-bar.js stays within its BOOKMARKS_BAR_LINE_BUDGET line budget', () => {
  const source = fs.readFileSync(BOOKMARKS_BAR_JS, 'utf8');
  const lines = source.split(/\r?\n/).length;
  assert.ok(
    lines <= BOOKMARKS_BAR_LINE_BUDGET,
    `bookmarks-bar.js has ${lines} lines; budget is ${BOOKMARKS_BAR_LINE_BUDGET}`
  );
});

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
  assert.ok(tier2.length >= 5, `expected at least 5 tier-2 (SHEET_STATES open:) identifiers, found ${tier2.length}`);

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
