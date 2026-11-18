'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  updateNoticeModel: model,
  downloadResultHint,
  DOWNLOAD_HINT,
  NO_DIRECT_HINT
} = require('../../src/shared/update-notice-model.js');

const NONE = {
  noticeText: '',
  showNotice: false,
  openLabel: '',
  kebabLabel: '',
  openAriaLabel: '',
  showDownload: false,
  downloadLabel: '',
  downloadAriaLabel: '',
  hintText: ''
};
const url = 'https://github.com/x/y/releases/tag/v0.19.16';

test('newer release: both surfaces get their text', () => {
  const m = model({ current: '0.19.15', available: '0.19.16', releaseUrl: url, checkEnabled: true });
  assert.deepEqual(m, {
    versionText: 'Goldfinch 0.19.15',
    noticeText: 'Version 0.19.16 is available.',
    showNotice: true,
    openLabel: 'View release notes',
    kebabLabel: 'Update available — 0.19.16',
    openAriaLabel: 'View release notes for version 0.19.16',
    showDownload: false,
    downloadLabel: '',
    downloadAriaLabel: '',
    hintText: NO_DIRECT_HINT
  });
});

test('notice + direct installer: the Download now button, its name, and the first hint', () => {
  const m = model({
    current: '0.19.15',
    available: '0.19.16',
    releaseUrl: url,
    downloadName: 'goldfinch_0.19.16_amd64.deb'
  });
  assert.equal(m.showNotice, true);
  assert.equal(m.showDownload, true);
  assert.equal(m.downloadLabel, 'Download now');
  assert.equal(m.downloadAriaLabel, 'Download version 0.19.16');
  assert.equal(m.hintText, DOWNLOAD_HINT);
  assert.equal(m.hintText, 'Downloads the installer for this computer. Run it to update.');
  assert.equal(m.openLabel, 'View release notes');
  assert.equal(m.openAriaLabel, 'View release notes for version 0.19.16');
});

test('notice without a direct installer: no button, the release-page hint', () => {
  const m = model({ current: '0.19.15', available: '0.19.16', releaseUrl: url, downloadName: null });
  assert.equal(m.showNotice, true);
  assert.equal(m.showDownload, false);
  assert.equal(m.downloadLabel, '');
  assert.equal(m.hintText, 'Download the installer for your system from the release page, then run it to update.');
});

test('a downloadName that is not an installer name for the offered version never shows the button', () => {
  for (const downloadName of ['evil.exe', 'goldfinch_0.19.17_amd64.deb', '', 5, {}, undefined, '../x', '<b>']) {
    const m = model({ current: '0.19.15', available: '0.19.16', releaseUrl: url, downloadName });
    assert.equal(m.showDownload, false, String(downloadName));
    assert.equal(m.hintText, NO_DIRECT_HINT);
  }
});

test('no notice: button and hint are empty even when a downloadName is present', () => {
  const m = model({
    current: '0.19.15',
    available: null,
    releaseUrl: null,
    downloadName: 'goldfinch_0.19.16_amd64.deb'
  });
  assert.deepEqual(m, { versionText: 'Goldfinch 0.19.15', ...NONE });
});

test('the hint after a click: started on ok, the release-page fallback on anything else', () => {
  const started = 'Download started — find it in Downloads, then run it to update.';
  const failed = 'Could not start the download. Use the release page instead.';
  assert.equal(downloadResultHint({ ok: true, name: 'x' }), started);
  assert.equal(downloadResultHint({ ok: true, name: 'x', already: true }), started);
  for (const r of [
    { ok: false, reason: 'unavailable' },
    { ok: false, reason: 'failed' },
    null,
    undefined,
    'x',
    5,
    {}
  ]) {
    assert.equal(downloadResultHint(r), failed);
  }
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

test('the running version is shown when well-formed, prerelease and build suffix included', () => {
  for (const current of ['0.19.15', '0.19.15-rc.2', '1.0.0-beta.1+build.5']) {
    assert.equal(model({ current }).versionText, `Goldfinch ${current}`);
  }
  const m = model({ current: '0.19.15-rc.2', available: '0.19.15', releaseUrl: url });
  assert.equal(m.versionText, 'Goldfinch 0.19.15-rc.2');
  assert.equal(m.showNotice, true);
  assert.equal(m.noticeText, 'Version 0.19.15 is available.');
});

test('a current that is missing or malformed shows "Goldfinch" alone, never "undefined"', () => {
  const long = '1.0.0-' + 'a'.repeat(200);
  for (const current of [undefined, null, 7, '<b>x', '0.19.15 <script>', '01.2.3', long, {}, '', '1.0', '1.0.0+']) {
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
