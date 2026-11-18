'use strict';

// The Concourse task images are pinned by digest (ci/README.md "Updating the
// Node image"). Structural scan of ci/tasks/*.yml: no stored baseline.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TASKS = path.join(__dirname, '..', '..', 'ci', 'tasks');
const files = fs.readdirSync(TASKS).filter((f) => f.endsWith('.yml'));

/** @param {string} text */
function imageBlock(text) {
  const m = text.match(/^image_resource:\n((?: {2,}.*\n|\s*\n)+)/m);
  return m ? m[1] : null;
}

/** @param {string} block */
function digestOf(block) {
  const m = block.match(/^ {2}version:\n {4}digest: '(sha256:[0-9a-f]{64})'/m);
  return m ? m[1] : null;
}

test('every task that names an image pins it by sha256 digest', () => {
  const pinned = [];
  for (const f of files) {
    const block = imageBlock(fs.readFileSync(path.join(TASKS, f), 'utf8'));
    if (block === null) continue;
    const digest = digestOf(block);
    assert.ok(digest, `${f}: image_resource has no version.digest sha256`);
    pinned.push([f, digest]);
  }
  assert.ok(pinned.length >= 6, 'expected the six node-image tasks');
});

test('all pinned digests are the same', () => {
  const digests = new Set();
  for (const f of files) {
    const block = imageBlock(fs.readFileSync(path.join(TASKS, f), 'utf8'));
    if (block !== null) digests.add(digestOf(block));
  }
  assert.equal(digests.size, 1, `digests differ across tasks: ${[...digests].join(', ')}`);
});
