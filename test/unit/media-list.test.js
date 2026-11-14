'use strict';

// src/main/media-list.js — the main-side rebuild of the page-supplied media list (Mission 23 Flight 1,
// leg `jar-isolation`, DD8). Pure and Electron-free.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateMediaList,
  isDownloadableMediaUrl,
  MAX_ITEMS,
  MAX_WEB_URL_LENGTH,
  MAX_DATA_URL_LENGTH,
  MAX_TEXT_LENGTH
} = require('../../src/main/media-list');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const img = (url, extra = {}) => ({ type: 'image', url, name: 'n', ...extra });

test('constants are the stated values', () => {
  assert.equal(MAX_ITEMS, 2000);
  assert.equal(MAX_WEB_URL_LENGTH, 2048);
  assert.equal(MAX_DATA_URL_LENGTH, 262144);
  assert.equal(MAX_TEXT_LENGTH, 256);
});

test('a well-formed list passes through unchanged, in order', () => {
  const list = [
    { type: 'image', url: 'https://example.com/a.png', name: 'a.png', width: 10, height: 20, alt: 'alt' },
    { type: 'video', url: 'http://example.com/v.mp4', name: 'v.mp4', poster: 'https://example.com/p.png' },
    { type: 'audio', url: 'https://example.com/t.mp3', name: 'Track', label: 'Track' },
    { type: 'embed', url: 'https://www.youtube.com/embed/x', name: 'www.youtube.com' }
  ];
  assert.deepEqual(validateMediaList(JSON.parse(JSON.stringify(list))), list);
});

for (const [label, url] of [
  ['goldfinch-media:', 'goldfinch-media://proxy/28/http%3A%2F%2Fexample.com%2Fx.png'],
  ['file:', 'file:///etc/hostname'],
  ['ftp:', 'ftp://example.com/x.mp3'],
  ['javascript:', 'javascript:alert(1)'],
  ['blob:', 'blob:https://example.com/uuid'],
  ['about:', 'about:blank'],
  ['a custom scheme', 'myapp://thing/x.png'],
  ['data:text/html', 'data:text/html,<script>alert(1)</script>'],
  ['data:image/svg+xml', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
  ['a relative string', '/x.png'],
  ['an empty string', '']
]) {
  test(`an item with a ${label} url is dropped whole`, () => {
    assert.deepEqual(validateMediaList([img(url), img('https://example.com/ok.png')]), [
      { type: 'image', url: 'https://example.com/ok.png', name: 'n' }
    ]);
  });
}

test('a data: image item survives for the raster types, with a synthesised name (never the payload)', () => {
  for (const t of ['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp']) {
    const url = `data:image/${t};base64,AAAA`;
    assert.deepEqual(validateMediaList([img(url, { name: url })]), [{ type: 'image', url, name: `image.${t}` }]);
  }
});

test('a data: image on a non-image item is dropped', () => {
  assert.deepEqual(validateMediaList([{ type: 'video', url: PNG, name: 'v' }]), []);
});

test('an oversize data: image is dropped, not truncated; the cap is checked before parsing', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(MAX_DATA_URL_LENGTH);
  assert.deepEqual(validateMediaList([img(big)]), []);
  const ok = 'data:image/png;base64,' + 'A'.repeat(MAX_DATA_URL_LENGTH - 30);
  assert.equal(validateMediaList([img(ok)]).length, 1);
});

test('an over-long web url is dropped before parsing', () => {
  const long = 'https://example.com/' + 'a'.repeat(MAX_WEB_URL_LENGTH);
  assert.deepEqual(validateMediaList([img(long)]), []);
});

test('a poster survives only as http(s); a failed poster is removed and the item kept', () => {
  const base = { type: 'video', url: 'https://example.com/v.mp4', name: 'v' };
  assert.deepEqual(
    validateMediaList([{ ...base, poster: 'https://example.com/p.png' }])[0].poster,
    'https://example.com/p.png'
  );
  for (const poster of ['file:///x.png', PNG, 'goldfinch-media://proxy/1/x', 5, null, {}]) {
    const out = validateMediaList([{ ...base, poster }]);
    assert.equal(out.length, 1);
    assert.equal('poster' in out[0], false);
  }
});

test('only the explicit fields survive; text is capped; numbers must be finite and non-negative', () => {
  const [item] = validateMediaList([
    {
      type: 'image',
      url: 'https://example.com/a.png',
      name: 'x'.repeat(MAX_TEXT_LENGTH + 50),
      label: 'l'.repeat(MAX_TEXT_LENGTH + 5),
      alt: 'a',
      width: -1,
      height: NaN,
      allowBlob: true,
      __proto__poison: 1,
      onclick: 'x'
    }
  ]);
  assert.deepEqual(Object.keys(item).sort(), ['alt', 'label', 'name', 'type', 'url']);
  assert.equal(item.name.length, MAX_TEXT_LENGTH);
  assert.equal(item.label.length, MAX_TEXT_LENGTH);
  const [d] = validateMediaList([img('https://example.com/a.png', { width: Infinity, height: 12 })]);
  assert.equal('width' in d, false);
  assert.equal(d.height, 12);
});

test('the preload leak (an extra boolean on embed items) and null optionals are dropped', () => {
  const [e] = validateMediaList([
    { type: 'embed', url: 'https://www.youtube.com/embed/x', name: 'yt', allowBlob: false, width: null, poster: null }
  ]);
  assert.deepEqual(e, { type: 'embed', url: 'https://www.youtube.com/embed/x', name: 'yt' });
  assert.deepEqual(validateMediaList([{ type: 'embed', url: 'blob:https://x/y', name: 'b', allowBlob: false }]), []);
});

test('an unknown type, a non-string url and a non-object item are dropped', () => {
  assert.deepEqual(
    validateMediaList([
      { type: 'script', url: 'https://example.com/x', name: 'x' },
      { type: 'image', url: 42, name: 'x' },
      { type: 'image', url: ['https://example.com/x.png'], name: 'x' },
      null,
      'str',
      7
    ]),
    []
  );
});

test('a non-array input is an empty list and never throws', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { length: 3 }, () => []]) {
    assert.deepEqual(validateMediaList(bad), []);
  }
});

test('an oversize list is cut at the item cap', () => {
  const list = Array.from({ length: MAX_ITEMS + 25 }, (_, i) => img(`https://example.com/${i}.png`));
  const out = validateMediaList(list);
  assert.equal(out.length, MAX_ITEMS);
  assert.equal(out[MAX_ITEMS - 1].url, `https://example.com/${MAX_ITEMS - 1}.png`);
});

test('a prototype-polluted item exposes nothing inherited', () => {
  const polluted = Object.create({ type: 'image', url: 'https://evil.example/x.png', name: 'x' });
  assert.deepEqual(validateMediaList([polluted]), []);
  const partial = Object.create({ url: 'file:///etc/passwd', poster: 'file:///x' });
  Object.assign(partial, { type: 'image', url: 'https://example.com/a.png', name: 'a' });
  assert.deepEqual(validateMediaList([partial]), [{ type: 'image', url: 'https://example.com/a.png', name: 'a' }]);
});

test('a getter-bearing item (defensive only - messages arrive as cloned plain data) drops that item alone', () => {
  const evil = { type: 'image', name: 'x' };
  Object.defineProperty(evil, 'url', {
    enumerable: true,
    get() {
      throw new Error('boom');
    }
  });
  assert.deepEqual(validateMediaList([evil, img('https://example.com/ok.png')]), [
    { type: 'image', url: 'https://example.com/ok.png', name: 'n' }
  ]);
});

test('a hostile array (throwing index getter) yields an empty or partial list, never a throw', () => {
  const arr = [img('https://example.com/a.png')];
  Object.defineProperty(arr, 1, {
    enumerable: true,
    get() {
      throw new Error('boom');
    }
  });
  arr.length = 2;
  assert.doesNotThrow(() => validateMediaList(arr));
});

test('isDownloadableMediaUrl: http, https, blob: and raster data: images only', () => {
  for (const ok of ['http://example.com/a', 'https://example.com/a', 'blob:https://example.com/uuid', PNG]) {
    assert.equal(isDownloadableMediaUrl(ok), true, ok);
  }
  for (const bad of [
    'file:///etc/hostname',
    'ftp://example.com/x',
    'javascript:alert(1)',
    'goldfinch-media://proxy/t/http%3A%2F%2Fa.example%2F',
    'data:image/svg+xml;base64,AAAA',
    'data:text/html,x',
    'about:blank',
    '',
    null,
    undefined,
    5,
    {}
  ]) {
    assert.equal(isDownloadableMediaUrl(bad), false, String(bad));
  }
});
