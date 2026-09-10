'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResolver } = require('../../src/main/internal-assets');
const { createInternalPageMap } = require('../../src/main/internal-page-map');

const joinPath = { join: (...parts) => parts.join('/') };

test('createInternalPageMap returns the exact current host/path allowlist', () => {
  const map = createInternalPageMap({ baseDir: '/app/src/main', path: joinPath });
  assert.deepEqual(Object.keys(map).sort(), ['downloads', 'jars', 'settings', 'vault']);
  assert.deepEqual(Object.keys(map.settings).sort(), [
    '/',
    '/audit-paging.js',
    '/safe-color.js',
    '/search-engines.js',
    '/settings.css',
    '/settings.js'
  ]);
  assert.deepEqual(Object.keys(map.downloads).sort(), ['/', '/downloads.css', '/downloads.js']);
  assert.deepEqual(Object.keys(map.jars).sort(), [
    '/',
    '/burner.js',
    '/jar-data-classes.js',
    '/jar-page-model.js',
    '/jar-panel-model.js',
    '/jars-confirm-modal.js',
    '/jars-cookies-panel.js',
    '/jars-create-controller.js',
    '/jars-history-panel.js',
    '/jars-nav-controller.js',
    '/jars-page-state.js',
    '/jars-section-controller.js',
    '/jars-sitedata-panel.js',
    '/jars-tabs.js',
    '/jars.css',
    '/jars.js',
    '/safe-color.js'
  ]);
  assert.deepEqual(Object.keys(map.vault).sort(), [
    '/',
    '/burner.js',
    '/jar-page-model.js',
    '/password-generator.js',
    '/safe-color.js',
    '/vault-browser-import-controller.js',
    '/vault-editor-model.js',
    '/vault-nav-controller.js',
    '/vault-page-model.js',
    '/vault.css',
    '/vault.js'
  ]);
  assert.equal(map.settings['/'], '/app/src/main/../renderer/pages/settings.html');
  assert.equal(map.settings['/search-engines.js'], '/app/src/main/../shared/search-engines.js');
  assert.equal(map.jars['/jar-page-model.js'], '/app/src/main/../shared/jar-page-model.js');
  assert.equal(map.vault['/'], '/app/src/main/../renderer/pages/vault.html');
  assert.equal(map.vault['/vault-page-model.js'], '/app/src/main/../shared/vault-page-model.js');
  assert.equal(map.vault['/vault-editor-model.js'], '/app/src/main/../shared/vault-editor-model.js');
  assert.equal(map.vault['/password-generator.js'], '/app/src/main/../shared/password-generator.js');
  assert.equal(map.vault['/safe-color.js'], '/app/src/main/../shared/safe-color.js');
  assert.equal(map.vault['/vault-nav-controller.js'], '/app/src/main/../renderer/pages/vault-nav-controller.js');
  // Squawk 0063: the jars page's shared PALETTE, allowlisted onto the vault route too.
  assert.equal(map.vault['/jar-page-model.js'], '/app/src/main/../shared/jar-page-model.js');
  // jar-page-model.js's own transitive import — omitting this blanked goldfinch://vault
  // (squawk-class fix; see the route-closure regression test in this directory).
  assert.equal(map.vault['/burner.js'], '/app/src/main/../shared/burner.js');
  // M19 F1 Leg 2: the browser-CSV-import page UI, its own controller module.
  assert.equal(
    map.vault['/vault-browser-import-controller.js'],
    '/app/src/main/../renderer/pages/vault-browser-import-controller.js'
  );
});

test('the existing resolver serves exact map entries and rejects traversal/wrong paths', () => {
  const resolve = createResolver(createInternalPageMap({ baseDir: '/app/src/main', path: joinPath }));
  assert.match(resolve('jars', '/jars.js').file, /renderer\/pages\/jars\.js$/);
  assert.equal(resolve('jars', '/../main.js'), null);
  assert.equal(resolve('jars', '/jars.js/../main.js'), null);
  assert.equal(resolve('jars', '/not-allowlisted.js'), null);
  assert.equal(resolve('unknown', '/'), null);
});
