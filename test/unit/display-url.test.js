'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { displayUrl } = require('../../src/shared/display-url.js');

test('displayUrl: unchanged when there is nothing to remove', () => {
  for (const u of [
    'http://example.com/',
    'https://example.com:8443/a?b=c#d',
    'http://[::1]:8080/x',
    'about:blank',
    'not a url @ at all',
    'blob:https://example.com/abc',
    'data:text/plain,a@b',
    'goldfinch://settings',
    'http://example.com/path@with-at?x=y@z#f@g',
    'http://@example.com/'
  ]) {
    assert.equal(displayUrl(u), u, u);
  }
});

test('displayUrl: removes username, password, both, empty-username password, percent-encoded', () => {
  const table = [
    ['http://user@example.com/', 'http://example.com/'],
    ['http://user:pass@example.com/p?q=1#h', 'http://example.com/p?q=1#h'],
    ['https://trusted.example@evil.example/login', 'https://evil.example/login'],
    ['http://:pw@example.com/', 'http://example.com/'],
    ['http://us%40er:p%3Ass@example.com:8080/x', 'http://example.com:8080/x'],
    ['http://probeuser:probepass@127.0.0.1:8231/userinfo-target.html', 'http://127.0.0.1:8231/userinfo-target.html'],
    ['http://u:p@[::1]:8080/x', 'http://[::1]:8080/x'],
    ['http://a:b@c@example.com/', 'http://example.com/']
  ];
  for (const [input, want] of table) assert.equal(displayUrl(input), want, input);
});

test('failureForChrome: copies with a clean url and leaves the stored record alone', () => {
  const { failureForChrome } = require('../../src/shared/display-url.js');
  const stored = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://u:p@nope.invalid/' };
  const shown = failureForChrome(stored);
  assert.equal(shown.url, 'http://nope.invalid/');
  assert.equal(stored.url, 'http://u:p@nope.invalid/');
  assert.equal(failureForChrome(null), null);
});

test('displayUrl: an unparseable string and non-strings come back unchanged', () => {
  assert.equal(displayUrl('http://a@'), 'http://a@');
  assert.equal(displayUrl(''), '');
  assert.equal(displayUrl(undefined), undefined);
});

test('capTitle: caps at 512, keeps shorter titles, never splits a surrogate pair', () => {
  const { capTitle, TITLE_MAX_CHARS } = require('../../src/shared/display-url.js');
  assert.equal(TITLE_MAX_CHARS, 512);
  assert.equal(capTitle('short'), 'short');
  assert.equal(capTitle('x'.repeat(100 * 1024)).length, 512);
  assert.equal(capTitle('a'.repeat(511) + '\u{1F600}').length, 511);
  assert.equal(capTitle(undefined), undefined);
});

test('displayUrl is applied only to what is displayed or stored (source-scan pin)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  const gw = read('src/main/guest-wiring.js');
  assert.match(gw, /sendToChrome\('tab-did-navigate',\s*\{\s*wcId,\s*url:\s*displayUrl\(url\)\s*\}\)/);
  assert.match(
    gw,
    /sendToChrome\('tab-did-navigate-in-page',\s*\{\s*wcId,\s*url:\s*displayUrl\(wc\.getURL\(\)\)\s*\}\)/
  );
  // It must never wrap a URL handed to navigation, the snapshot or credential code.
  for (const f of ['src/main/session-snapshot.js', 'src/main/auth-challenges.js', 'src/main/closed-tab-capture.js']) {
    assert.doesNotMatch(read(f), /displayUrl/, f);
  }
  assert.doesNotMatch(read('src/main/register-tab-ipc.js'), /displayUrl\(/);
  assert.match(gw, /sendToChrome\('tab-title',\s*\{\s*wcId,\s*title:\s*capTitle\(title\)\s*\}\)/);
  assert.match(gw, /failure:\s*failureForChrome\(entry\.loadFailure\)/);
  assert.match(read('src/main/register-tab-ipc.js'), /failure:\s*failureForChrome\(entry\.loadFailure\)/);
  assert.match(read('src/main/history-recorder.js'), /displayUrl/);
  // Review fix C4: the crash push (both sites) and the window-move / recovery adopt payload.
  assert.match(gw, /sendToChrome\('tab-crash',\s*\{\s*wcId,\s*crash:\s*crashForChrome\(entry\.crash\)\s*\}\)/);
  assert.match(read('src/main/register-tab-ipc.js'), /crash:\s*crashForChrome\(entry\.crash\)/);
  assert.match(read('src/main/move-tab-payload.js'), /url:\s*displayUrl\(\(live && live\.getURL\(\)\) \|\| p\.url\)/);
});
