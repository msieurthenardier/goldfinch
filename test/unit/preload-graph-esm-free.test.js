'use strict';

// DD3a — preload-graph-ESM-free invariant pin (flight 03, leg 2 / F2 debrief
// Rec 2). The two PRELOAD-REACHABLE CJS-by-design modules
// (src/shared/automation-dev.js, src/shared/internal-page.js) are required by
// chrome-preload.js via the RENDERER process's Node `require`, which has NO
// require(esm) support. If a future edit adds a require() edge from one of
// these files (or anything they come to require) onto a converted-to-ESM
// module, that edge breaks under a real Electron boot — the exact blocker
// class hit in the M07 Flight 2 leg-1 conversion. This defect class is
// invisible to a plain `npm test` run because vanilla Node ≥22's require()
// loads top-level-`export` files transparently via syntax detection (an
// Electron-42-empirical constraint, not a vanilla-Node one — see the leg's
// design-review notes; this pin is source-text based, so it holds under
// either runtime behavior).
//
// This test is a FORWARD PIN, not a closed-cache assertion: it requires the
// two modules, walks require.cache for every entry resolved under
// src/shared/, and asserts none of those cached sources contain top-level
// ESM export syntax. It does NOT assert the cache contains ONLY those two
// files — a future legitimate CJS-by-design addition must not fail this
// test; only an ESM-source file reached via require() should.
//
// If this fails legitimately (a src/shared/ file these two now reach really
// did convert to ESM): do not "fix" the test — fix the require edge. Keep
// the file CJS, or move the converted logic behind a non-preload-reachable
// module, per the CJS-by-design quartet rule in CLAUDE.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Pure detector (AC1): does this source contain a top-level ESM export
// statement? Line-anchored (`^...`, multiline flag) so a `// export ...`
// prose/comment mention can never match — the comment's `//` sits at line
// start, before `export`. The `async\b` alternative is REQUIRED: it covers
// `export async function` / `export async function*`, live in the repo today
// (scripts/lib/mcp-client.mjs:58) and absent from a naive
// `export\s+(default|const|let|var|function|class)` detector
// (design-review-found gap).
// ---------------------------------------------------------------------------
function sourceHasEsmExport(src) {
  return /^export\s+(?:default\b|async\b|const\b|let\b|var\b|function\b|class\b|\{|\*)/m.test(src);
}

// ---------------------------------------------------------------------------
// AC2 — truth table pinning the detector itself, independent of any live
// file. REQUIRED cases per the leg spec, plus the async-function-generator
// variant and a couple of extra false-positive guards.
// ---------------------------------------------------------------------------
test('sourceHasEsmExport — truth table', () => {
  const trueCases = [
    'export function x(){}',
    'export async function x(){}',
    'export async function* gen(){}',
    'export const X = 1',
    'export default function foo(){}',
    'export default 42;',
    'export class Foo {}',
    'export { a, b };',
    "export * from './x.js';"
  ];
  for (const src of trueCases) {
    assert.equal(sourceHasEsmExport(src), true, `expected ESM export detected in: ${JSON.stringify(src)}`);
  }

  const falseCases = [
    '// export nothing',
    'module.exports = {};',
    "'use strict';\nmodule.exports = { a: 1 };",
    '// this module requires(esm) internally — see notes on export semantics',
    'const s = "a string mentioning the word export inside prose/comments"; // not a real export'
  ];
  for (const src of falseCases) {
    assert.equal(sourceHasEsmExport(src), false, `expected NO ESM export detected in: ${JSON.stringify(src)}`);
  }
});

// ---------------------------------------------------------------------------
// AC1 — the live require-cache pin. require() the two PRELOAD-REACHABLE
// modules exactly as chrome-preload.js does (extensionless specifiers), then
// walk require.cache for every entry resolved under src/shared/ and assert
// none of their sources trip the ESM-export detector.
//
// Anti-vacuous (per Implementation Guidance): assert the walk found at LEAST
// the two required modules themselves — an empty filter set would mean the
// test isn't walking what it thinks.
// ---------------------------------------------------------------------------
test('require-cache pin: no src/shared/ module reached via require() is ESM', () => {
  require('../../src/shared/automation-dev');
  require('../../src/shared/internal-page');

  const sharedSegment = path.join('src', 'shared');
  const cachedSharedPaths = Object.keys(require.cache).filter((k) => k.includes(sharedSegment));

  assert.ok(
    cachedSharedPaths.length >= 2,
    `expected at least the two required src/shared/ modules in require.cache, found ${cachedSharedPaths.length} — ` +
      'an empty/short filter set means this walk is not reaching what it thinks (anti-vacuous guard)'
  );

  for (const cachedPath of cachedSharedPaths) {
    const src = fs.readFileSync(cachedPath, 'utf8');
    assert.equal(
      sourceHasEsmExport(src),
      false,
      `${cachedPath} is reachable via require() from a PRELOAD-REACHABLE src/shared/ module but contains a ` +
        'top-level ESM export — this is the preload-graph-ESM-free invariant (DD3a): a require() edge onto a ' +
        'converted module breaks under real Electron (require(esm) is unsupported there), even though vanilla ' +
        'Node loads it transparently.'
    );
  }
});
