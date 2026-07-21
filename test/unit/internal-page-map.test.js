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
    '/password-generator.js',
    '/vault-editor-model.js',
    '/vault-page-model.js',
    '/vault.css',
    '/vault.js'
  ]);
  assert.equal(map.settings['/'], '/app/src/main/../renderer/pages/settings.html');
  assert.equal(map.jars['/jar-page-model.js'], '/app/src/main/../shared/jar-page-model.js');
  assert.equal(map.vault['/'], '/app/src/main/../renderer/pages/vault.html');
  assert.equal(map.vault['/vault-page-model.js'], '/app/src/main/../shared/vault-page-model.js');
  assert.equal(map.vault['/vault-editor-model.js'], '/app/src/main/../shared/vault-editor-model.js');
  assert.equal(map.vault['/password-generator.js'], '/app/src/main/../shared/password-generator.js');
});

test('the existing resolver serves exact map entries and rejects traversal/wrong paths', () => {
  const resolve = createResolver(createInternalPageMap({ baseDir: '/app/src/main', path: joinPath }));
  assert.match(resolve('jars', '/jars.js').file, /renderer\/pages\/jars\.js$/);
  assert.equal(resolve('jars', '/../main.js'), null);
  assert.equal(resolve('jars', '/jars.js/../main.js'), null);
  assert.equal(resolve('jars', '/not-allowlisted.js'), null);
  assert.equal(resolve('unknown', '/'), null);
});
