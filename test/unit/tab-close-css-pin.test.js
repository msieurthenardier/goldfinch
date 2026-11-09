'use strict';
// Sortie 08 HAT: the tab close button is right-aligned at every width.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.tab .tab-close pins margin-left: auto', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/styles.css'), 'utf8');
  const m = /\.tab \.tab-close\s*\{([^}]*)\}/.exec(css);
  if (!m) throw new Error('.tab .tab-close rule not found');
  assert.match(m[1], /margin-left:\s*auto\s*;/);
});
