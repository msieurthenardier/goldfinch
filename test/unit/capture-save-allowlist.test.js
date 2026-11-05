'use strict';

// Sortie 06 Leg 2 (AC10 / flight DD7): every vault write for a held capture goes through
// `captureSave`, reached ONLY via the four-guarded `save-prompt:save` (the manager's `captureSave`
// dep, bound by the window-factory delegate) or the consented finalize inside vault-human.js.
// A grep-AC pin: the EXACT `{ file: count }` of `captureSave(` call/definition sites in `src/`
// (comment lines stripped). A new call site goes red until a human judges it. Throws on zero hits.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith('.js') || ent.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('AC10: the exact allowlist of `captureSave(` sites in src/', () => {
  /** @type {Record<string, number>} */
  const found = {};
  for (const file of walk(SRC)) {
    const code = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    const n = (code.match(/captureSave\(/g) || []).length;
    if (n > 0) found[path.relative(SRC, file).split(path.sep).join('/')] = n;
  }
  assert.ok(Object.keys(found).length > 0, 'the scan found ZERO sites - it is vacuous');
  assert.deepEqual(found, {
    // the window-factory delegate bound to the manager's `captureSave` dep (the `:save` path)
    'main/window-factory.js': 1,
    // the manager's single call inside `save()` (after the IPC's four guards)
    'main/save-prompt-manager.js': 1,
    // the definition + the ONE consented finalize call (gated on `rec.consent`)
    'main/vault/vault-human.js': 2
  });
});
