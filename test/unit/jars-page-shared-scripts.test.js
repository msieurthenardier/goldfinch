'use strict';

// Regression net for the goldfinch://jars internal page (M06 Flight 3, Leg 1),
// sibling to test/unit/chrome-shared-scripts.test.js. That net only matches
// `../shared/*.js` relative <script src> paths — the ones src/renderer/index.html
// uses — but internal pages serve their scripts via FLAT srcs resolved through the
// INTERNAL_PAGES protocol map (main.js), so it cannot be pointed at jars.html
// (design-review verified, leg spec AC).
//
// jars.html loads several classic (non-module) <script> tags that all share ONE
// global lexical environment in the internal-page document (identical to
// index.html's chrome document — see the original test's header for the full
// mechanism). This test reproduces that shared-global-scope semantics with Node's
// `vm` module and replays EVERY script jars.html loads, self-derived from the file
// (not hand-maintained), in the exact order the page loads them: burner.js,
// safe-color.js, jar-page-model.js, and jars.js itself. A future second top-level
// `const`/`let`/`class` declared across any of these would throw a SyntaxError at
// PARSE time in a real browser — invisible to `require()`-based unit tests (each
// module gets its own module scope there) — and this test catches it instead.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JARS_HTML = path.join(__dirname, '../../src/renderer/pages/jars.html');
const SHARED_DIR = path.join(__dirname, '../../src/shared');
const PAGES_DIR = path.join(__dirname, '../../src/renderer/pages');

// Parse the ordered list of <script src="....js"> tags straight out of jars.html —
// sourced from the real file, not a hand-maintained list, so this test tracks
// jars.html's actual load order and script set without drifting. Internal pages use
// flat srcs (no '../shared/' prefix — the protocol map resolves 'jar-page-model.js'
// etc. to src/shared/ transparently), so any *.js src counts, in document order.
function jarsScriptFiles() {
  const html = fs.readFileSync(JARS_HTML, 'utf8');
  const files = [];
  const re = /<script\s+src="([^"]+\.js)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) files.push(m[1]);
  return files;
}

// A flat script name resolves to src/shared/ (jar-page-model.js, safe-color.js,
// burner.js — the three INTERNAL_PAGES shared-file entries this leg adds) or
// src/renderer/pages/ (the page's own jars.js) — mirroring how main.js's
// INTERNAL_PAGES.jars map resolves each pathname. Resolution is by existence, not a
// hardcoded list, so a future added/removed shared script is picked up automatically.
function resolveScriptFile(name) {
  const sharedPath = path.join(SHARED_DIR, name);
  if (fs.existsSync(sharedPath)) return sharedPath;
  const pagePath = path.join(PAGES_DIR, name);
  if (fs.existsSync(pagePath)) return pagePath;
  throw new Error(`jars.html references "${name}" but it exists in neither src/shared/ nor src/renderer/pages/`);
}

test('jars.html script load order is non-empty (guards against a silent parse regression)', () => {
  assert.ok(jarsScriptFiles().length >= 4, 'expected burner.js, safe-color.js, jar-page-model.js, and jars.js in jars.html');
});

test('every script jars.html loads resolves to a real file on disk', () => {
  for (const file of jarsScriptFiles()) {
    assert.doesNotThrow(() => resolveScriptFile(file), `"${file}" should resolve under src/shared/ or src/renderer/pages/`);
  }
});

test('every script jars.html loads executes with no top-level identifier collision', () => {
  const files = jarsScriptFiles();
  // A fresh vm context mirrors the internal-page document's realm: no
  // `module`/`require` (nodeIntegration:false + contextIsolation:true, matching
  // the real internal-preload.js contextBridge setup), so every dual-export
  // module takes its `globalThis`-assignment branch — same as in the browser —
  // and each script's top-level const/let lands in ONE shared lexical
  // environment, exactly like separate <script> tags in one document.
  //
  // `window` is aliased to the sandbox object itself (self-reference), matching
  // globalThis identity in a real document, so jars.js's `window.goldfinchInternal`
  // guard read resolves to `undefined` (guard returns early) instead of throwing
  // a ReferenceError for an undefined `window` — vm contexts have no DOM globals.
  const sandbox = {};
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(resolveScriptFile(file), 'utf8');
    assert.doesNotThrow(
      () => vm.runInContext(source, context, { filename: file }),
      (err) => {
        throw new Error(`jars.html's "${file}" failed to load into the shared internal-page script scope: ${err && err.message}`);
      }
    );
  }
});
