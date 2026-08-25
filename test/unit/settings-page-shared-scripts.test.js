'use strict';

// Script-tag contract test for the goldfinch://settings internal page, sibling
// to test/unit/jars-page-shared-scripts.test.js / vault-page-shared-scripts.test.js.
// Internal pages serve their scripts via FLAT srcs resolved through the
// INTERNAL_PAGES protocol map, so a typo'd flat src 404s at boot and nothing
// else static catches it — this existence-resolution + route-map check is the
// only static net for that class. Everything self-derives from settings.html
// on disk.
//
// M16 F1 Leg 2 (DD7) adds the search-engine radio group and its
// /search-engines.js route. Per the leg spec's Outputs section: no
// DOM-driven controller-test harness exists for ANY internal page (design
// review confirmed — this file, like its jars/vault siblings, asserts
// script-tag structure and route wiring only, never instantiates a
// controller). Live radio behavior (checked state, change→settingsSet,
// onSettingsChanged re-sync) is covered by the behavior specs, not here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SETTINGS_HTML = path.join(__dirname, '../../src/renderer/pages/settings.html');
const SETTINGS_JS = path.join(__dirname, '../../src/renderer/pages/settings.js');
const SHARED_DIR = path.join(__dirname, '../../src/shared');
const PAGES_DIR = path.join(__dirname, '../../src/renderer/pages');
const MAIN_DIR = path.join(__dirname, '../../src/main');
const { createInternalPageMap } = require('../../src/main/internal-page-map');
const { SEARCH_ENGINES } = require('../../src/shared/search-engines');

function settingsScriptTags() {
  const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
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

function resolveScriptFile(name) {
  const sharedPath = path.join(SHARED_DIR, name);
  if (fs.existsSync(sharedPath)) return sharedPath;
  const pagePath = path.join(PAGES_DIR, name);
  if (fs.existsSync(pagePath)) return pagePath;
  throw new Error(`settings.html references "${name}" but it exists in neither src/shared/ nor src/renderer/pages/`);
}

function isSharedSrc(src) {
  return !src.includes('/') && fs.existsSync(path.join(SHARED_DIR, src));
}

test('settings.html loads its own controller script and the search-engines table', () => {
  const tags = settingsScriptTags();
  assert.ok(tags.some((t) => t.src === 'settings.js'), 'settings.html must load settings.js');
  assert.ok(
    tags.some((t) => t.src === 'search-engines.js'),
    'settings.html must load search-engines.js (M16 F1 Leg 2 / DD7 — the radio group\'s single source table)'
  );
});

test('settings.html: once any script is a module, every classic script tag carries defer (DD3)', () => {
  const tags = settingsScriptTags();
  const hasModule = tags.some((t) => t.isModule);
  if (!hasModule) return; // the rule binds only on pages that load module scripts
  for (const t of tags) {
    if (t.isModule) continue;
    assert.ok(
      t.hasDefer,
      `settings.html loads "${t.src}" as a non-defer classic script on a page with module scripts — ` +
        'it would execute during parse, BEFORE any module, inverting document order (DD3)'
    );
  }
});

test('every script settings.html loads resolves to a real file on disk', () => {
  for (const { src } of settingsScriptTags()) {
    assert.doesNotThrow(() => resolveScriptFile(src), `"${src}" should resolve under src/shared/ or src/renderer/pages/`);
  }
});

test('settings.html shared-file script tags are type="module" (src/shared/ is ESM)', () => {
  for (const t of settingsScriptTags()) {
    if (!isSharedSrc(t.src)) continue;
    assert.ok(
      t.isModule,
      `settings.html loads the shared file "${t.src}" as a classic script — src/shared/ is ESM, ` +
        'and a classic tag on an ESM file is a parse-time SyntaxError only a live boot would catch'
    );
  }
});

test('the search-engines module has an exact internal route (M16 F1 Leg 2 / DD7)', () => {
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path }).settings;
  assert.equal(map['/search-engines.js'], path.join(SHARED_DIR, 'search-engines.js'));
  assert.ok(fs.existsSync(map['/search-engines.js']));
  // No directory passthrough: a disk-relative or wrong path stays unmapped.
  assert.equal(map['/pages/search-engines.js'], undefined);
  assert.equal(map['/shared/search-engines.js'], undefined);
});

test('no engine id/label/description is duplicated in settings.html\'s search-engine fieldset or in settings.js (DD7: single source is search-engines.js)', () => {
  // Scoped to the search-engine fieldset specifically (not the whole document)
  // — settings.html legitimately mentions "Google" elsewhere (the spellcheck
  // note's dictionary-download copy), which is unrelated product prose, not a
  // duplicated engine entry, and would otherwise false-positive this check.
  const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
  const fieldsetMatch = /<fieldset class="shields-group search-engine-group">[\s\S]*?<\/fieldset>/.exec(html);
  assert.ok(fieldsetMatch, 'settings.html must have a "search-engine-group" fieldset (M16 F1 Leg 2 / DD7)');
  const fieldsetHtml = fieldsetMatch[0];
  const js = fs.readFileSync(SETTINGS_JS, 'utf8');
  assert.ok(SEARCH_ENGINES.length > 0, 'sanity: the curated table must be non-empty for this check to mean anything');
  for (const engine of SEARCH_ENGINES) {
    assert.ok(
      !fieldsetHtml.includes(engine.id) && !fieldsetHtml.includes(engine.label) && !fieldsetHtml.includes(engine.description),
      `settings.html's search-engine fieldset contains engine data for "${engine.id}" — engine data must come only ` +
        'from search-engines.js, rendered at runtime by settings.js'
    );
    assert.ok(
      !js.includes(engine.label) && !js.includes(engine.description),
      `settings.js contains a literal engine label/description for "${engine.id}" — it must render from the ` +
        'imported SEARCH_ENGINES table, never a hand-typed copy'
    );
  }
});
