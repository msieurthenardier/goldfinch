'use strict';

// CSS↔JS pin for the bookmarks bar's layout constants (M15 F3 "Drag
// Interactions" Leg 2, DD10 — a Flight 2 debrief carry-forward).
//
// `bookmarks-bar.js`'s overflow partition budgets the row in JS: it cannot see
// styles.css, so it mirrors three CSS values as fixed literals (BAR_GAP,
// BAR_PADDING_X, CHEVRON_WIDTH). Both sides carry back-reference comments, and
// both sides drifted anyway — the M15 F2 Leg 4 behavior-test defect (the
// chevron laid out past the bar's content edge and clipped away by
// `overflow: hidden`) shipped through an entire flight because changing the
// CSS left the suite green. This test is that missing red.
//
// Source-scan style, on `csp-pins.test.js`'s `extractCsp` model: read the CSS
// as text and THROW when a rule block or a declaration cannot be located,
// rather than returning a falsy value that would make the comparisons
// vacuously true. Rules are located by SELECTOR, never by line number — the
// pin must survive the rules moving, or it becomes the drift it exists to
// catch.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STYLES_CSS = path.join(__dirname, '../../src/renderer/styles.css');
const BOOKMARKS_BAR_JS = path.join(__dirname, '../../src/renderer/chrome/bookmarks-bar.js');

const { BAR_GAP, BAR_PADDING_X, CHEVRON_WIDTH } = require('../../src/renderer/chrome/bookmarks-bar.js');

/** styles.css with /* … *\/ comments stripped, so a value mentioned in prose
 * can never be mistaken for a declaration. */
function cssSource() {
  return fs.readFileSync(STYLES_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The declaration block for a rule whose selector list is EXACTLY `selector`
 * (so `#bookmarks-bar .bm-item` never answers for `#bookmarks-bar`).
 * Throws when the rule is absent.
 * @param {string} css @param {string} selector @returns {string}
 */
function ruleBlock(css, selector) {
  const re = new RegExp(`(?:^|[};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'm');
  const m = re.exec(css);
  if (!m) throw new Error(`No rule with selector "${selector}" found in ${STYLES_CSS}`);
  return m[1];
}

/**
 * One declaration's value from a block. Throws when the property is absent —
 * a renamed/removed declaration must fail loudly, not compare against ''.
 * @param {string} block @param {string} prop @param {string} selector
 * @returns {string}
 */
function declaration(block, prop, selector) {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;}]+)`, 'i');
  const m = re.exec(block);
  if (!m || !m[1].trim()) {
    throw new Error(`Declaration "${prop}" not found in rule "${selector}" of ${STYLES_CSS}`);
  }
  return m[1].trim();
}

/** `12px` -> 12. Throws on any non-`px` / non-integer value (a switch to
 * `em`/`var()` invalidates the JS mirror and must fail here).
 * @param {string} value @param {string} what @returns {number} */
function px(value, what) {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (!m) throw new Error(`${what} is "${value}" — the JS mirror only holds for an integer px literal`);
  return Number(m[1]);
}

/** The horizontal component of a `padding` shorthand (1–4 values).
 * @param {string} value @returns {{ vertical: string, horizontal: string }} */
function paddingParts(value) {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) throw new Error(`Unparseable padding shorthand: "${value}"`);
  const vertical = parts[0];
  const horizontal = parts.length === 1 ? parts[0] : parts[1];
  return { vertical, horizontal };
}

test('#bookmarks-bar gap is pinned to bookmarks-bar.js BAR_GAP', () => {
  const block = ruleBlock(cssSource(), '#bookmarks-bar');
  const gap = declaration(block, 'gap', '#bookmarks-bar');
  assert.equal(
    px(gap, '#bookmarks-bar gap'), BAR_GAP,
    `styles.css #bookmarks-bar { gap: ${gap} } and bookmarks-bar.js BAR_GAP = ${BAR_GAP} have DRIFTED — ` +
    'the overflow partition budgets the gap in JS and cannot read the CSS. Change both or neither.',
  );
});

test('#bookmarks-bar horizontal padding is pinned to bookmarks-bar.js BAR_PADDING_X', () => {
  const block = ruleBlock(cssSource(), '#bookmarks-bar');
  const padding = declaration(block, 'padding', '#bookmarks-bar');
  const { vertical, horizontal } = paddingParts(padding);
  assert.equal(vertical, '0', `#bookmarks-bar vertical padding is "${vertical}" — the fixed 30px height assumes 0`);
  assert.equal(
    px(horizontal, '#bookmarks-bar horizontal padding'), BAR_PADDING_X,
    `styles.css #bookmarks-bar { padding: ${padding} } and bookmarks-bar.js BAR_PADDING_X = ${BAR_PADDING_X} ` +
    'have DRIFTED — the partition budgets both sides in JS. Change both or neither.',
  );
});

test('#bookmarks-overflow width is pinned to bookmarks-bar.js CHEVRON_WIDTH', () => {
  const block = ruleBlock(cssSource(), '#bookmarks-overflow');
  const width = declaration(block, 'width', '#bookmarks-overflow');
  assert.equal(
    px(width, '#bookmarks-overflow width'), CHEVRON_WIDTH,
    `styles.css #bookmarks-overflow { width: ${width} } and bookmarks-bar.js CHEVRON_WIDTH = ${CHEVRON_WIDTH} ` +
    'have DRIFTED — the partition reserves the chevron footprint rather than measuring a possibly-hidden ' +
    'element. Change both or neither.',
  );
});

// Under-pinning guard (leg Edge Case "a fourth constant is added later"): the
// three constants above are the WHOLE set of numeric module constants
// bookmarks-bar.js exports. A fourth arrives -> this fails, and whoever added
// it decides whether it needs a CSS pin of its own.
test('bookmarks-bar.js exports exactly the three pinned numeric constants', () => {
  const src = fs.readFileSync(BOOKMARKS_BAR_JS, 'utf8');
  const found = [...src.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=\s*-?\d/gm)].map((m) => m[1]).sort();
  assert.deepEqual(
    found, ['BAR_GAP', 'BAR_PADDING_X', 'CHEVRON_WIDTH'],
    'bookmarks-bar.js exports a numeric constant this CSS pin does not cover (or lost one it did) — ' +
    'add it to this test or drop it from the export list, so the pin can never silently under-cover.',
  );
});

// Non-vacuity: the extractors must THROW on an absent rule or declaration
// rather than quietly comparing against an empty value.
test('the extractors throw loudly on a missing rule or declaration (non-vacuous)', () => {
  const css = cssSource();
  assert.throws(() => ruleBlock(css, '#bookmarks-bar-that-does-not-exist'), /No rule with selector/);
  const block = ruleBlock(css, '#bookmarks-bar');
  assert.throws(() => declaration(block, 'no-such-property', '#bookmarks-bar'), /not found in rule/);
  assert.throws(() => px('1.5em', 'x'), /integer px literal/);
});
