'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitDownloadName, EXTENSION_PATTERN } = require('../../src/shared/download-name-split.js');

test('splits stem and extension', () => {
  assert.deepEqual(splitDownloadName('report.exe'), { stem: 'report', ext: '.exe' });
  assert.deepEqual(splitDownloadName('archive.tar.gz'), { stem: 'archive.tar', ext: '.gz' });
  const long = 'a'.repeat(200);
  assert.deepEqual(splitDownloadName(long + '.exe'), { stem: long, ext: '.exe' });
});

test('no extension renders as stem only', () => {
  assert.deepEqual(splitDownloadName('README'), { stem: 'README', ext: '' });
  assert.deepEqual(splitDownloadName('.bashrc'), { stem: '.bashrc', ext: '' });
  assert.deepEqual(splitDownloadName('name.'), { stem: 'name.', ext: '' });
  assert.deepEqual(splitDownloadName('name.' + 'x'.repeat(17)), { stem: 'name.' + 'x'.repeat(17), ext: '' });
  assert.deepEqual(splitDownloadName('a.b c'), { stem: 'a.b c', ext: '' });
  assert.deepEqual(splitDownloadName(''), { stem: '', ext: '' });
  assert.deepEqual(splitDownloadName(null), { stem: '', ext: '' });
});

test('16-character extension is kept', () => {
  assert.deepEqual(splitDownloadName('f.' + 'x'.repeat(16)), { stem: 'f', ext: '.' + 'x'.repeat(16) });
});

test('drift guard: same extension rule as download-path.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/download-path.js'), 'utf8');
  const m = /const EXTENSION_PATTERN = (\/.*\/);/.exec(src);
  assert.ok(m, 'EXTENSION_PATTERN literal found in download-path.js');
  assert.equal(String(EXTENSION_PATTERN), m[1]);
});
