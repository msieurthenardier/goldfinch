'use strict';

// Automation-boundary pin for the cross-vault copy (Sortie 04 Leg 1 / DD10): no
// MCP tool can start a copy, and nothing under src/main/automation/ references
// the copy channel, the store op, or the planner. Grep-AC style; no boot.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildToolRegistry } = require('../../src/main/automation/mcp-tools');

const AUTOMATION_DIR = path.join(__dirname, '../../src/main/automation');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('src/main/automation/** has zero references to the copy channel, copyItem or copy-plan', () => {
  const files = walk(AUTOMATION_DIR);
  assert.ok(files.length > 5, 'sanity: the tree was actually scanned');
  const hits = files.filter((f) => /internal-vault-item-copy|copyItem|copy-plan/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});

test('the MCP tool count is still 35 and no tool name matches /copy/i', () => {
  const registry = buildToolRegistry(
    () => null,
    () => null
  );
  const names = registry.listTools().map((t) => t.name);
  assert.equal(names.length, 35);
  assert.deepEqual(
    names.filter((n) => /copy/i.test(n)),
    []
  );
});
