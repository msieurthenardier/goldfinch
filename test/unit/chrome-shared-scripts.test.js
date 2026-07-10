'use strict';

// Regression net for M06 Flight 2 Leg 3 D1: `src/renderer/index.html` loads its
// `src/shared/*.js` modules as separate classic (non-module) <script> tags, which
// all share ONE global lexical environment in the chrome document. A top-level
// `const`/`let`/`class` declared in two of those scripts collides — the second
// script's parse step throws `SyntaxError: Identifier 'X' has already been
// declared`, which silently kills that ENTIRE script (nothing in it — not even
// its function declarations — ever runs), while every script tag before and
// after it keeps loading normally. This is invisible to the Node-runner unit
// suite: `require()` gives each shared module its own module scope, so a
// collision that is fatal in the browser's shared-script-tag realm never
// reproduces under `require()`. D1 (Leg 3) hit exactly this: burner.js's
// top-level `const BURNER` and container-menu.js's top-level
// `const { BURNER } = ...` both landed in index.html's shared global scope,
// breaking buildContainerModel() on every real boot while every unit test
// (which only ever requires container-menu.js in isolation) stayed green.
//
// This test reproduces the browser's shared-global-scope semantics with Node's
// `vm` module (a fresh vm context's top-level lexical environment behaves
// identically to a document's — verified: a second `vm.runInContext('const X=2')`
// after `const X=1` throws the same SyntaxError a browser would) and replays
// EVERY `../shared/*.js` <script> tag from index.html, in the exact order the
// browser loads them, in one shared context. Any future top-level identifier
// collision among those scripts fails this test instead of only surfacing on a
// live boot.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_HTML = path.join(__dirname, '../../src/renderer/index.html');
const SHARED_DIR = path.join(__dirname, '../../src/shared');

// Parse the ordered list of `../shared/*.js` <script src="..."> tags straight out
// of index.html — sourced from the real file, not a hand-maintained list, so this
// test tracks index.html's actual load order and script set without drifting.
function sharedScriptFiles() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const files = [];
  const re = /<script src="\.\.\/shared\/([^"]+\.js)"><\/script>/g;
  let m;
  while ((m = re.exec(html))) files.push(m[1]);
  return files;
}

test('index.html shared-script load order is non-empty (guards against a silent parse regression)', () => {
  assert.ok(sharedScriptFiles().length >= 5, 'expected several ../shared/*.js <script> tags in index.html');
});

test('every ../shared/*.js script index.html loads executes with no top-level identifier collision', () => {
  const files = sharedScriptFiles();
  // A fresh vm context mirrors the chrome document's realm: no `module`/`require`
  // (nodeIntegration:false, matching the real chrome-preload contextBridge setup),
  // so every dual-export module takes its `globalThis`-assignment branch — same as
  // in the browser — and each script's top-level const/let lands in ONE shared
  // lexical environment, exactly like separate <script> tags in one document.
  const context = vm.createContext({});
  for (const file of files) {
    const source = fs.readFileSync(path.join(SHARED_DIR, file), 'utf8');
    assert.doesNotThrow(
      () => vm.runInContext(source, context, { filename: file }),
      (err) => {
        throw new Error(`src/shared/${file} failed to load into the shared chrome script scope: ${err && err.message}`);
      }
    );
  }
});
