'use strict';

// Script-tag contract test for the goldfinch://vault internal page (M12 Flight 3,
// Leg 1), sibling to test/unit/jars-page-shared-scripts.test.js. Internal pages
// serve their scripts via FLAT srcs resolved through the INTERNAL_PAGES protocol
// map, so a typo'd flat src 404s at boot and nothing else static catches it — this
// existence-resolution + route-map check is the only static net for that class. The
// module/defer pins ride alongside. Everything self-derives from vault.html on disk.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const VAULT_HTML = path.join(__dirname, '../../src/renderer/pages/vault.html');
const SHARED_DIR = path.join(__dirname, '../../src/shared');
const PAGES_DIR = path.join(__dirname, '../../src/renderer/pages');
const MAIN_DIR = path.join(__dirname, '../../src/main');
const { createInternalPageMap } = require('../../src/main/internal-page-map');

function vaultScriptTags() {
  const html = fs.readFileSync(VAULT_HTML, 'utf8');
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
  throw new Error(`vault.html references "${name}" but it exists in neither src/shared/ nor src/renderer/pages/`);
}

function isSharedSrc(src) {
  return !src.includes('/') && fs.existsSync(path.join(SHARED_DIR, src));
}

test('vault.html loads at least its own controller script', () => {
  const tags = vaultScriptTags();
  assert.ok(tags.some((t) => t.src === 'vault.js'), 'vault.html must load vault.js');
});

test('vault.html: once any script is a module, every classic script tag carries defer (DD3)', () => {
  const tags = vaultScriptTags();
  const hasModule = tags.some((t) => t.isModule);
  if (!hasModule) return;
  for (const t of tags) {
    if (t.isModule) continue;
    assert.ok(t.hasDefer, `vault.html loads "${t.src}" as a non-defer classic script on a page with module scripts`);
  }
});

test('every script vault.html loads resolves to a real file on disk', () => {
  for (const { src } of vaultScriptTags()) {
    assert.doesNotThrow(() => resolveScriptFile(src), `"${src}" should resolve under src/shared/ or src/renderer/pages/`);
  }
});

test('the vault controller and its shared imports have exact internal routes', () => {
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path }).vault;
  assert.equal(map['/'], path.join(PAGES_DIR, 'vault.html'));
  assert.equal(map['/vault.css'], path.join(PAGES_DIR, 'vault.css'));
  assert.equal(map['/vault.js'], path.join(PAGES_DIR, 'vault.js'));
  // The pure state-model is a src/shared/ file served flat — it needs its own route.
  assert.equal(map['/vault-page-model.js'], path.join(SHARED_DIR, 'vault-page-model.js'));
  assert.ok(fs.existsSync(map['/vault-page-model.js']));
  // Leg 2: the pure editor-logic module the page imports also needs its exact route.
  assert.equal(map['/vault-editor-model.js'], path.join(SHARED_DIR, 'vault-editor-model.js'));
  assert.ok(fs.existsSync(map['/vault-editor-model.js']));
  // Leg 3: the pure password generator the editor imports also needs its exact route.
  assert.equal(map['/password-generator.js'], path.join(SHARED_DIR, 'password-generator.js'));
  assert.ok(fs.existsSync(map['/password-generator.js']));
  // M12 F5 HAT (nav+main restructure): the injection-safe color validator (shared) + the
  // mirrored nav controller (page-local) the page now imports.
  assert.equal(map['/safe-color.js'], path.join(SHARED_DIR, 'safe-color.js'));
  assert.ok(fs.existsSync(map['/safe-color.js']));
  assert.equal(map['/vault-nav-controller.js'], path.join(PAGES_DIR, 'vault-nav-controller.js'));
  assert.ok(fs.existsSync(map['/vault-nav-controller.js']));
  // No directory passthrough: a disk-relative or wrong path stays unmapped.
  assert.equal(map['/pages/vault.js'], undefined);
});

test('vault.html shared-file script tags are type="module" (src/shared/ is ESM)', () => {
  for (const t of vaultScriptTags()) {
    if (!isSharedSrc(t.src)) continue;
    assert.ok(t.isModule, `vault.html loads shared file "${t.src}" as a classic script — src/shared/ is ESM`);
  }
});
