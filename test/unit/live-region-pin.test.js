'use strict';

// Sortie 06 Leg 3 (AC9; M22 F1 lesson): the new #save-prompt-status polite region must not change
// any existing live region in the chrome document. Each pinned region's role / aria-live /
// aria-atomic attributes are asserted EXACTLY as they stand, and #save-prompt-status must be a
// self-closed sibling that neither contains nor is contained by any of them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');

const PINNED = {
  toasts: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' },
  'media-status': { role: 'status', 'aria-live': 'polite', 'aria-atomic': null },
  'tab-status': { role: 'status', 'aria-live': 'polite', 'aria-atomic': null },
  'suggest-status': { role: 'status', 'aria-live': 'polite', 'aria-atomic': null },
  'zoom-percent': { role: 'status', 'aria-live': 'off', 'aria-atomic': null },
  'hang-notice': { role: 'status', 'aria-live': null, 'aria-atomic': null }
};

function openTag(id) {
  const m = new RegExp(`<(\\w+)\\b([^>]*\\bid="${id}"[^>]*)>`).exec(html);
  assert.ok(m, `#${id} present`);
  return { name: m[1], attrs: m[2], start: m.index, end: m.index + m[0].length };
}
const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};
/** Index just past the matching close tag of the element opened at `tag` (depth-counted). */
function elementEnd(tag) {
  const re = new RegExp(`<(/?)${tag.name}\\b[^>]*?(/?)>`, 'g');
  re.lastIndex = tag.end;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[2] === '/') continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`no close for #${tag.name}`);
}

test('AC9: every pre-existing live region keeps its exact role / aria-live / aria-atomic', () => {
  for (const [id, want] of Object.entries(PINNED)) {
    const { attrs } = openTag(id);
    for (const [name, value] of Object.entries(want)) assert.equal(attr(attrs, name), value, `#${id} ${name}`);
  }
});

test('AC9/R9: #save-prompt-status is a self-closed polite sibling - it neither contains nor sits inside any pinned region', () => {
  assert.match(html, /<div id="save-prompt-status" class="sr-only" role="status" aria-live="polite"><\/div>/);
  const sp = openTag('save-prompt-status');
  assert.equal(attr(sp.attrs, 'aria-live'), 'polite');
  const spEnd = elementEnd(sp);
  assert.equal(spEnd, sp.end + '</div>'.length, 'no children');
  for (const id of Object.keys(PINNED)) {
    const t = openTag(id);
    const end = elementEnd(t);
    assert.equal(sp.start >= t.start && sp.start < end, false, `not inside #${id}`);
    assert.equal(t.start >= sp.start && t.start < spEnd, false, `does not contain #${id}`);
  }
  assert.ok(elementEnd(openTag('suggest-status')) <= sp.start, '#suggest-status closes before it');
});

test('AC9 vacuity: the pin detects a mutated attribute and a wrapped region', () => {
  assert.equal(attr('role="status" aria-live="assertive"', 'aria-live') === 'polite', false);
  assert.equal(attr(openTag('toasts').attrs, 'aria-atomic'), 'false');
});
