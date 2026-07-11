'use strict';

// Script-tag contract tests for the goldfinch://jars internal page, sibling
// to test/unit/chrome-shared-scripts.test.js (which hosts the all-documents
// DD3 + module pins). This file keeps the jars page's SPECIALTY: internal
// pages serve their scripts via FLAT srcs resolved through the INTERNAL_PAGES
// protocol map (main.js), so a typo'd flat src 404s at boot and nothing else
// static catches it — the existence-resolution test below is the only static
// net for that class. The page-scoped count/DD3/module pins ride alongside.
// Everything is self-derived from jars.html on disk, never a hand-maintained
// list.
//
// History: until M07 Flight 2 this file was a shared-scope vm-replay net —
// classic <script> tags share ONE top-level lexical environment per document,
// and the net replayed jars.html's classic scripts in one Node `vm` context
// to catch top-level identifier collisions statically. The ESM conversion
// made that class structurally impossible (module scripts get their own
// scope), so the replay machinery retired with the conversion's
// retire-machinery leg — see missions/07-maintenance/flights/02-esm-conversion/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const JARS_HTML = path.join(__dirname, '../../src/renderer/pages/jars.html');
const SHARED_DIR = path.join(__dirname, '../../src/shared');
const PAGES_DIR = path.join(__dirname, '../../src/renderer/pages');

// Parse EVERY <script ... src="..."> tag straight out of jars.html — sourced
// from the real file, not a hand-maintained list, so this test tracks
// jars.html's actual load order and script set without drifting. Internal
// pages use flat srcs (no '../shared/' prefix — the protocol map resolves
// 'jar-page-model.js' etc. to src/shared/ transparently), so any *.js src
// counts, in document order. Attribute parsing is order-insensitive (src /
// type="module" / defer may appear in any order inside the tag).
function jarsScriptTags() {
  const html = fs.readFileSync(JARS_HTML, 'utf8');
  const tags = [];
  const re = /<script\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const srcMatch = /\bsrc="([^"]+\.js)"/.exec(attrs);
    if (!srcMatch) continue;
    tags.push({
      src: srcMatch[1],
      isModule: /\btype="module"/.test(attrs),
      hasDefer: /\bdefer\b/.test(attrs)
    });
  }
  return tags;
}

// A flat script name resolves to src/shared/ (burner.js, jar-data-classes.js,
// safe-color.js, jar-page-model.js — the INTERNAL_PAGES shared-file entries)
// or src/renderer/pages/ (the page's own jars.js) — mirroring how main.js's
// INTERNAL_PAGES.jars map resolves each pathname. Resolution is by existence,
// not a hardcoded list, so a future added/removed shared script is picked up
// automatically.
function resolveScriptFile(name) {
  const sharedPath = path.join(SHARED_DIR, name);
  if (fs.existsSync(sharedPath)) return sharedPath;
  const pagePath = path.join(PAGES_DIR, name);
  if (fs.existsSync(pagePath)) return pagePath;
  throw new Error(`jars.html references "${name}" but it exists in neither src/shared/ nor src/renderer/pages/`);
}

// A tag references a src/shared/ file when its flat name exists there (see
// resolveScriptFile above — shared wins over page-local, and no page-local
// script name collides with a src/shared/ name today).
function isSharedSrc(src) {
  return !src.includes('/') && fs.existsSync(path.join(SHARED_DIR, src));
}

test('jars.html script load order is non-empty (guards against a silent parse regression)', () => {
  assert.ok(jarsScriptTags().length >= 4, 'expected burner.js, jar-data-classes.js, safe-color.js, jar-page-model.js, and jars.js in jars.html');
});

test('jars.html pins DD3: once any script is a module, every classic script tag carries defer', () => {
  const tags = jarsScriptTags();
  const hasModule = tags.some((t) => t.isModule);
  if (!hasModule) return; // the rule binds only on pages that load module scripts
  for (const t of tags) {
    if (t.isModule) continue;
    assert.ok(
      t.hasDefer,
      `jars.html loads "${t.src}" as a non-defer classic script on a page with module scripts — ` +
        'it would execute during parse, BEFORE any module, inverting document order (DD3)'
    );
  }
});

test('every script jars.html loads resolves to a real file on disk', () => {
  for (const { src } of jarsScriptTags()) {
    assert.doesNotThrow(() => resolveScriptFile(src), `"${src}" should resolve under src/shared/ or src/renderer/pages/`);
  }
});

test('jars.html module pin: every src/shared/*.js script tag is type="module"', () => {
  for (const t of jarsScriptTags()) {
    if (!isSharedSrc(t.src)) continue;
    assert.ok(
      t.isModule,
      `jars.html loads the shared file "${t.src}" as a classic script — src/shared/ is ESM, ` +
        'and a classic tag on an ESM file is a parse-time SyntaxError only a live boot would catch'
    );
  }
});
