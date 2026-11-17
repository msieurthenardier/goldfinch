'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { updateNoticeModel: model } = require('../../src/shared/update-notice-model.js');

const NONE = { noticeText: '', showNotice: false, openLabel: '', kebabLabel: '', openAriaLabel: '' };
const url = 'https://github.com/x/y/releases/tag/v0.19.16';

test('newer release: both surfaces get their text', () => {
  const m = model({ current: '0.19.15', available: '0.19.16', releaseUrl: url, checkEnabled: true });
  assert.deepEqual(m, {
    versionText: 'Goldfinch 0.19.15',
    noticeText: 'Version 0.19.16 is available.',
    showNotice: true,
    openLabel: 'View release notes',
    kebabLabel: 'Update available — 0.19.16',
    openAriaLabel: 'View release notes for version 0.19.16'
  });
});

test('no newer release: version only', () => {
  assert.deepEqual(model({ current: '0.19.15', available: null, releaseUrl: null }), {
    versionText: 'Goldfinch 0.19.15',
    ...NONE
  });
});

test('available without a release address is no notice', () => {
  assert.equal(model({ current: '0.19.15', available: '0.19.16', releaseUrl: null }).showNotice, false);
  assert.equal(model({ current: '0.19.15', available: '0.19.16', releaseUrl: '' }).showNotice, false);
  assert.equal(model({ current: '0.19.15', available: '0.19.16', releaseUrl: 5 }).showNotice, false);
});

test('hostile or malformed shapes show nothing and never throw', () => {
  for (const available of ['<b>x', {}, 5, 'v0.19.16', '0.19.16-rc.1', '01.2.3', '0.19.16 ', null, undefined]) {
    const m = model({ current: '0.19.15', available, releaseUrl: url });
    assert.equal(m.showNotice, false, String(available));
    assert.equal(m.noticeText, '');
    assert.equal(m.kebabLabel, '');
  }
  for (const state of [null, undefined, 'x', 5, [], {}]) {
    const m = model(state);
    assert.deepEqual(m, { versionText: 'Goldfinch', ...NONE });
  }
});

test('a current that is not a stable version never prints "undefined"', () => {
  for (const current of [undefined, null, 7, '<i>', '0.19.15-rc.1', {}]) {
    assert.equal(model({ current }).versionText, 'Goldfinch');
  }
});

test('a throwing getter is swallowed', () => {
  const state = {
    get current() {
      throw new Error('x');
    }
  };
  assert.equal(model(state).showNotice, false);
});
