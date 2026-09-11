'use strict';

// Regression test for the "routed module has an unrouted transitive import"
// defect class — the root cause of the Leg 3 HAT finding where goldfinch://vault
// rendered blank: squawk 0063 routed '/jar-page-model.js' onto the vault entry in
// internal-page-map.js but not jar-page-model.js's own `import { BURNER } from
// './burner.js'`, so the ES-module graph 404'd mid-load and the whole page blanked.
//
// The existing sibling tests (internal-page-map.test.js, vault-page-shared-scripts
// .test.js, jars-page-shared-scripts.test.js) only check the page's exact allowlist
// keys and its single top-level <script> tag — none of them walk the actual `import
// … from './x.js'` graph a routed module pulls in. This test closes that gap for
// every internal-page host, not just vault: for each host, it starts from every
// routed serving path that maps to a real .js file, follows each file's relative
// (`./…`) ES imports (the flat-specifier convention internal pages use — see
// CLAUDE.md's "Two specifier shapes, by consumer"), and asserts every import target
// is itself routed for that same host. Pure/offline: no Electron, no boot — fs +
// a regex over `from '…'`, per the "New-shared-module checklist" / "Grep-AC
// convention" house style.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createInternalPageMap } = require('../../src/main/internal-page-map');

const MAIN_DIR = path.join(__dirname, '../../src/main');

// Captures the specifier out of both `import {…} from '…'` and `export {…} from
// '…'` — both forms use `from '…'`, and no internal-page module uses a bare
// side-effect `import './x.js'` (grep-verified) so this covers the real graph.
const IMPORT_RE = /from\s+['"](\.\/[^'"]+)['"]/g;

function relativeImportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    specs.push(m[1]);
  }
  return specs;
}

// Walks the transitive closure of one host's routed .js modules' relative ES
// imports. Internal pages resolve a flat specifier like './burner.js' against the
// page's single flat serving namespace for that host — never real disk nesting —
// so a target is looked up by BASENAME against the host's own route map, matching
// how the browser actually resolves it at runtime (and how it 404s when it can't).
function walkClosure(map, host) {
  const routes = map[host];
  const visited = new Set(); // basenames discovered as import targets
  const missing = []; // entries whose basename has no route on this host

  const jsEntries = Object.entries(routes).filter(
    ([routePath, file]) => routePath !== '/' && path.extname(file) === '.js'
  );
  const queue = jsEntries.map(([, file]) => file);
  const seenFiles = new Set(queue);

  while (queue.length) {
    const file = queue.shift();
    if (!fs.existsSync(file)) continue; // a missing routed file is its own, separate defect
    for (const spec of relativeImportsOf(file)) {
      const basename = path.posix.basename(spec);
      visited.add(basename);
      const routePath = `/${basename}`;
      const target = routes[routePath];
      if (!target) {
        missing.push({ fromFile: path.relative(process.cwd(), file), spec, routePath });
        continue;
      }
      if (!seenFiles.has(target)) {
        seenFiles.add(target);
        queue.push(target);
      }
    }
  }

  return { visited, missing };
}

test('every internal-page host routes the full transitive closure of its modules’ relative imports', () => {
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path });
  for (const host of Object.keys(map)) {
    const { missing } = walkClosure(map, host);
    assert.deepEqual(
      missing,
      [],
      `host "${host}" has unrouted relative import(s), which 404s the module graph and blanks the ` +
        `page: ${missing
          .map((m) => `${m.fromFile} imports "${m.spec}" — needs a "${m.routePath}" route on the ${host} entry`)
          .join('; ')}`
    );
  }
});

test('non-vacuous: the vault closure walk discovers burner.js transitively via jar-page-model.js', () => {
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path });
  const { visited } = walkClosure(map, 'vault');
  assert.ok(
    visited.has('burner.js'),
    'expected the vault closure walk to discover burner.js as a transitive import of jar-page-model.js — ' +
      'if this fails, the walk above is not actually traversing imports and its assertions are vacuous'
  );
});

test('non-vacuous: deleting the vault /burner.js route reproduces the HAT defect as a failing closure check', () => {
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path });
  delete map.vault['/burner.js'];
  const { missing } = walkClosure(map, 'vault');
  assert.ok(
    missing.some((m) => m.routePath === '/burner.js'),
    'removing the vault /burner.js route should surface it as a missing route (this reproduces the ' +
      'exact blank-page defect this test file guards against)'
  );
});
