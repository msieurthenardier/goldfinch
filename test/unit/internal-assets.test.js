'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contentTypeFor, createResolver } = require('../../src/main/internal-assets');
const { createInternalPageMap } = require('../../src/main/internal-page-map');

// ---------------------------------------------------------------------------
// Synthetic map with predictable fake paths (no real files needed — the
// resolver never touches the filesystem; main.js owns absolute-path resolution).
// ---------------------------------------------------------------------------

const FAKE_HTML = '/fake/pages/settings.html';
const FAKE_CSS = '/fake/pages/settings.css';
const FAKE_JS = '/fake/pages/settings.js';
const FAKE_AUDIT_JS = '/fake/shared/audit-paging.js';

const syntheticMap = {
  settings: {
    '/': FAKE_HTML,
    '/settings.css': FAKE_CSS,
    '/settings.js': FAKE_JS,
    '/audit-paging.js': FAKE_AUDIT_JS
  }
};

const resolve = createResolver(syntheticMap);

// ---------------------------------------------------------------------------
// contentTypeFor — by file extension
// ---------------------------------------------------------------------------

test('contentTypeFor: .html → text/html; charset=utf-8', () => {
  assert.equal(contentTypeFor('/any/path/page.html'), 'text/html; charset=utf-8');
});

test('contentTypeFor: .css → text/css; charset=utf-8', () => {
  assert.equal(contentTypeFor('/any/path/style.css'), 'text/css; charset=utf-8');
});

test('contentTypeFor: .js → text/javascript; charset=utf-8', () => {
  assert.equal(contentTypeFor('/any/path/app.js'), 'text/javascript; charset=utf-8');
});

test('contentTypeFor: unknown extension → application/octet-stream (conservative default)', () => {
  assert.equal(contentTypeFor('/any/path/data.bin'), 'application/octet-stream');
});

test('contentTypeFor: no extension → application/octet-stream', () => {
  assert.equal(contentTypeFor('/any/path/noext'), 'application/octet-stream');
});

test('contentTypeFor: uppercase extension (.CSS) treated separately — extension is lowercased', () => {
  // Our implementation lowercases the extension, so .CSS → text/css.
  assert.equal(contentTypeFor('/any/path/style.CSS'), 'text/css; charset=utf-8');
});

// ---------------------------------------------------------------------------
// resolve — allowlisted paths
// ---------------------------------------------------------------------------

test('resolve: / → settings.html with text/html content-type', () => {
  const result = resolve('settings', '/');
  assert.ok(result !== null, 'expected non-null result for /');
  assert.equal(result.file, FAKE_HTML);
  assert.equal(result.contentType, 'text/html; charset=utf-8');
});

test('resolve: empty string pathname normalized to / → settings.html', () => {
  // WHATWG URL parser yields pathname '' for "goldfinch://settings" in Node
  const result = resolve('settings', '');
  assert.ok(result !== null, 'expected non-null result for empty pathname');
  assert.equal(result.file, FAKE_HTML);
  assert.equal(result.contentType, 'text/html; charset=utf-8');
});

test('resolve: /settings.css → settings.css with text/css content-type', () => {
  const result = resolve('settings', '/settings.css');
  assert.ok(result !== null, 'expected non-null result for /settings.css');
  assert.equal(result.file, FAKE_CSS);
  assert.equal(result.contentType, 'text/css; charset=utf-8');
});

test('resolve: /settings.js → settings.js with text/javascript content-type', () => {
  const result = resolve('settings', '/settings.js');
  assert.ok(result !== null, 'expected non-null result for /settings.js');
  assert.equal(result.file, FAKE_JS);
  assert.equal(result.contentType, 'text/javascript; charset=utf-8');
});

test('resolve: /audit-paging.js → the shared module with text/javascript content-type', () => {
  // Leg 9 fix: settings.html loads audit-paging.js as a same-origin <script>, so
  // the internal scheme MUST serve it from its allowlist (a ../shared/ path 404s).
  const result = resolve('settings', '/audit-paging.js');
  assert.ok(result !== null, 'expected non-null result for /audit-paging.js');
  assert.equal(result.file, FAKE_AUDIT_JS);
  assert.equal(result.contentType, 'text/javascript; charset=utf-8');
});

// ---------------------------------------------------------------------------
// resolve — traversal and garbage paths → null
// ---------------------------------------------------------------------------

test('resolve: /../main.js → null (traversal attempt)', () => {
  assert.equal(resolve('settings', '/../main.js'), null);
});

test('resolve: /settings.css/../x → null (traversal through allowlisted prefix)', () => {
  assert.equal(resolve('settings', '/settings.css/../x'), null);
});

test('resolve: /settings.css/ → null (trailing slash changes the key)', () => {
  assert.equal(resolve('settings', '/settings.css/'), null);
});

test('resolve: //settings.css → null (double-leading-slash)', () => {
  assert.equal(resolve('settings', '//settings.css'), null);
});

test('resolve: /nope → null (not in map)', () => {
  assert.equal(resolve('settings', '/nope'), null);
});

test('resolve: /SETTINGS.CSS → null (case-mismatch; map is case-sensitive)', () => {
  // Policy: exact-match only — a casing mismatch 404s. This is the simplest
  // and safest choice; no ambiguity about which file to serve.
  assert.equal(resolve('settings', '/SETTINGS.CSS'), null);
});

test('resolve: /Settings.css → null (mixed-case mismatch)', () => {
  assert.equal(resolve('settings', '/Settings.css'), null);
});

// ---------------------------------------------------------------------------
// resolve — unknown / empty host → null
// ---------------------------------------------------------------------------

test('resolve: unknown host → null', () => {
  assert.equal(resolve('unknown', '/'), null);
});

test('resolve: empty string host → null', () => {
  assert.equal(resolve('', '/'), null);
});

test('resolve: host not in map but path would match if host were → null', () => {
  assert.equal(resolve('other', '/settings.css'), null);
});

// ---------------------------------------------------------------------------
// resolve — multiple hosts in map (isolation check)
// ---------------------------------------------------------------------------

test('resolve: a second host resolves its own paths independently', () => {
  const FAKE_OTHER_HTML = '/fake/other/index.html';
  const twoHostMap = {
    settings: { '/': FAKE_HTML },
    other: { '/': FAKE_OTHER_HTML }
  };
  const r = createResolver(twoHostMap);
  const s = r('settings', '/');
  const o = r('other', '/');
  assert.ok(s !== null);
  assert.equal(s.file, FAKE_HTML);
  assert.ok(o !== null);
  assert.equal(o.file, FAKE_OTHER_HTML);
  // Cross-host isolation: settings path doesn't bleed into other and vice versa
  assert.equal(r('settings', '/settings.css'), null); // not in twoHostMap
  assert.equal(r('other', '/settings.css'), null);
});

test('resolver accepts the production map builder without weakening exact-path refusal', () => {
  const map = createInternalPageMap({
    baseDir: '/fake/main',
    path: { join: (...parts) => parts.join('/') }
  });
  const productionResolve = createResolver(map);
  assert.match(productionResolve('downloads', '/downloads.js').file, /renderer\/pages\/downloads\.js$/);
  assert.equal(productionResolve('downloads', '/../main.js'), null);
  assert.equal(productionResolve('downloads', '/downloads.js/extra'), null);
});
