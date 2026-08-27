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
  assert.ok(
    tags.some((t) => t.src === 'settings.js'),
    'settings.html must load settings.js'
  );
  assert.ok(
    tags.some((t) => t.src === 'search-engines.js'),
    "settings.html must load search-engines.js (M16 F1 Leg 2 / DD7 — the radio group's single source table)"
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
    assert.doesNotThrow(
      () => resolveScriptFile(src),
      `"${src}" should resolve under src/shared/ or src/renderer/pages/`
    );
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

test('settings.js defines a persistent home-page unset hint and reflects it from both the initial load and the settings-changed broadcast (M16 F2 Leg 2 acceptance-gate fix)', () => {
  // Grep-shape structural check, not a DOM assertion — per this file's house
  // note above, no DOM harness exists for internal pages; live behavior
  // (the hint appearing/disappearing as homePage changes, including from an
  // external write) is covered by the welcome-first-launch / welcome-home-routing
  // behavior specs, not here.
  const js = fs.readFileSync(SETTINGS_JS, 'utf8');
  const startMarker = '/* ---- home-page controller ---- */';
  const endMarker = '/* ---- search-engine controller';
  const start = js.indexOf(startMarker);
  const end = js.indexOf(endMarker);
  assert.ok(
    start !== -1 && end !== -1 && end > start,
    'settings.js must have a home-page controller IIFE followed by the search-engine controller IIFE'
  );
  const block = js.slice(start, end);

  assert.ok(
    /const HOME_UNSET_HINT\s*=\s*'No home page chosen/.test(block),
    "settings.js's home-page controller must define HOME_UNSET_HINT, symmetric with the search-engine block's UNSET_HINT"
  );
  // Grep-AC hygiene rule: no literal search-engine name anywhere in this block.
  assert.equal(
    /google/i.test(block),
    false,
    'the home-page controller block must not mention any search-engine literal'
  );

  // The broadcast handler (onSettingsChanged) must render through the SAME
  // reflect() helper as the initial load — not a bespoke inline assignment —
  // so the hint (and the field) are never missed on an external write (the
  // welcome surface's Set, or another window's Settings page).
  const broadcastMatch = /onSettingsChanged\(\(all\) => \{[\s\S]*?\}\);/.exec(block);
  assert.ok(broadcastMatch, 'home-page controller must register an onSettingsChanged handler');
  assert.ok(
    /reflect\(all\.homePage\)/.test(broadcastMatch[0]),
    'the settings-changed broadcast handler must call reflect(all.homePage) so the unset hint (and the field) ' +
      'update on an external write, not just on load'
  );
});

test("no engine id/label/description is duplicated in settings.html's search-engine fieldset or in settings.js (DD7: single source is search-engines.js)", () => {
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
      !fieldsetHtml.includes(engine.id) &&
        !fieldsetHtml.includes(engine.label) &&
        !fieldsetHtml.includes(engine.description),
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

// ---------------------------------------------------------------------------
// M16 F3 Leg 1 (DD3): both Clear buttons carry the secondary button variant,
// and settings.css defines the variant rule and #home-page-clear's gap.
// Grep-shape per this file's house convention — no DOM harness for internal
// pages.
// ---------------------------------------------------------------------------
test('both Clear buttons carry settings-btn settings-btn--secondary, and settings.css defines the variant + margin (M16 F3 Leg 1, DD3)', () => {
  const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
  const settingsCss = fs.readFileSync(path.join(__dirname, '../../src/renderer/pages/settings.css'), 'utf8');

  for (const id of ['home-page-clear', 'search-engine-clear']) {
    const tagMatch = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(html);
    assert.ok(tagMatch, `settings.html must have a button with id="${id}"`);
    assert.ok(
      /class="[^"]*\bsettings-btn\b[^"]*\bsettings-btn--secondary\b[^"]*"/.test(tagMatch[0]) ||
        /class="[^"]*\bsettings-btn--secondary\b[^"]*\bsettings-btn\b[^"]*"/.test(tagMatch[0]),
      `#${id} must carry both "settings-btn" and "settings-btn--secondary"`
    );
  }

  assert.ok(/\.settings-btn--secondary\s*{/.test(settingsCss), 'settings.css must define .settings-btn--secondary');
  assert.ok(
    /#home-page-clear\s*{[^}]*margin-left:\s*8px/.test(settingsCss),
    "settings.css must give #home-page-clear an explicit margin-left (Save's gap is Save's own rule, not .settings-btn's)"
  );
});
