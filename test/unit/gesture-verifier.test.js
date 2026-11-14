'use strict';

// The pure verifier behind "only a real click raises the vault picker" (Mission 23 Flight 1, leg
// `vault-fill-trust`): every refusal reason, the order of the checks, window boundaries, the box tolerance
// at zoom 1 / 1.5 / 0.67, an injected click (press and release in the same instant), the box bound, the
// rate rule; plus the committed-origin read (NF12) and the destination display string.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  WITNESS_WINDOW_MS,
  RATE_INTERVAL_MS,
  ICON_WIDTH,
  ICON_HEIGHT,
  BOX_MAX_FACTOR,
  BOX_TOLERANCE_PX,
  emptyRecord,
  readBox,
  verifyGesture
} = require('../../src/main/vault/gesture-verifier');
const { committedOriginOf } = require('../../src/main/vault/committed-origin');
const { destinationDisplay } = require('../../src/shared/vault-destination');
const iconModule = require('../../src/preload/vault-fill-icon');

const ORIGIN = 'https://example.com';
const BOX = { x: 100, y: 50, width: 30, height: 16 };
const IN_BOX = { x: 115, y: 58 }; // view point inside BOX at zoom 1

/** A record with a left click (press at t, release at t + gap) at `pt`, and nothing else. */
function clickRecord(t, pt = IN_BOX, gap = 80) {
  return { leftDown: { ...pt, t }, leftUp: { ...pt, t: t + gap }, rightDown: null };
}
const verify = (over = {}) =>
  verifyGesture({
    kind: 'gesture',
    record: clickRecord(1000),
    message: { box: BOX },
    zoom: 1,
    now: 1200,
    origin: ORIGIN,
    lastAcceptedAt: null,
    ...over
  });

test('the constants are the stated ones, and the icon size is drift-guarded against the preload', () => {
  assert.equal(WITNESS_WINDOW_MS, 2000);
  assert.equal(RATE_INTERVAL_MS, 1000);
  assert.equal(BOX_MAX_FACTOR, 4);
  assert.equal(ICON_WIDTH, iconModule.ICON_WIDTH, 'verifier icon width === vault-fill-icon.js');
  assert.equal(ICON_HEIGHT, iconModule.ICON_HEIGHT, 'verifier icon height === vault-fill-icon.js');
});

test('an honest real click inside the reported box is accepted', () => {
  assert.deepEqual(verify(), { ok: true });
});

test('refusal order: origin, then no-real-input, then bad-box, then outside-box, then rate', () => {
  // Everything wrong at once names the FIRST check.
  const everythingWrong = { origin: null, record: emptyRecord(), message: {}, lastAcceptedAt: 1199 };
  assert.deepEqual(verify(everythingWrong), { ok: false, reason: 'origin' });
  assert.deepEqual(verify({ ...everythingWrong, origin: ORIGIN }), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(verify({ ...everythingWrong, origin: ORIGIN, record: clickRecord(1000) }), {
    ok: false,
    reason: 'bad-box'
  });
  assert.deepEqual(
    verify({
      origin: ORIGIN,
      record: clickRecord(1000, { x: 5, y: 5 }),
      message: { box: BOX },
      lastAcceptedAt: 1199
    }),
    { ok: false, reason: 'outside-box' }
  );
  assert.deepEqual(verify({ lastAcceptedAt: 1199 }), { ok: false, reason: 'rate' });
});

test('origin: null / empty / non-string committed origin refuses', () => {
  for (const origin of [null, undefined, '', 5]) assert.deepEqual(verify({ origin }), { ok: false, reason: 'origin' });
});

test('no-real-input: an empty record, a missing release, a missing press, a release before its press', () => {
  assert.deepEqual(verify({ record: emptyRecord() }), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(verify({ record: null }), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(verify({ record: { ...clickRecord(1000), leftUp: null } }), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(verify({ record: { ...clickRecord(1000), leftDown: null } }), {
    ok: false,
    reason: 'no-real-input'
  });
  // A press that arrived AFTER the release (a click in progress): the release has no press before it.
  assert.deepEqual(
    verify({ record: { leftDown: { ...IN_BOX, t: 1150 }, leftUp: { ...IN_BOX, t: 1100 }, rightDown: null } }),
    { ok: false, reason: 'no-real-input' }
  );
  // A right-button press is not a left click.
  assert.deepEqual(verify({ record: { leftDown: null, leftUp: null, rightDown: { ...IN_BOX, t: 1100 } } }), {
    ok: false,
    reason: 'no-real-input'
  });
});

test('window boundaries: usable up to and including 2000 ms after the release, refused after; never from the future', () => {
  const record = clickRecord(1000, IN_BOX, 0); // release at t=1000
  assert.deepEqual(verify({ record, now: 1000 }), { ok: true }, 'same instant');
  assert.deepEqual(verify({ record, now: 1000 + WITNESS_WINDOW_MS }), { ok: true }, 'exactly at the limit');
  assert.deepEqual(verify({ record, now: 1000 + WITNESS_WINDOW_MS + 1 }), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(verify({ record, now: 999 }), { ok: false, reason: 'no-real-input' }, 'a release in the future');
});

test('an injected click (press and release in the SAME instant) is accepted: ordering is checked, never a duration', () => {
  assert.deepEqual(verify({ record: clickRecord(1000, IN_BOX, 0), now: 1001 }), { ok: true });
});

test('bad-box: not four finite numbers, non-positive size, or larger than four times the icon', () => {
  const bad = [
    undefined,
    null,
    {},
    { box: null },
    { box: 'x' },
    { box: { x: 1, y: 2, width: 30 } },
    { box: { x: NaN, y: 2, width: 30, height: 16 } },
    { box: { x: 1, y: Infinity, width: 30, height: 16 } },
    { box: { x: 1, y: 2, width: '30', height: 16 } },
    { box: { x: 1, y: 2, width: 0, height: 16 } },
    { box: { x: 1, y: 2, width: 30, height: -1 } },
    { box: { x: 100, y: 50, width: ICON_WIDTH * BOX_MAX_FACTOR + 1, height: 16 } },
    { box: { x: 100, y: 50, width: 30, height: ICON_HEIGHT * BOX_MAX_FACTOR + 1 } }
  ];
  for (const message of bad)
    assert.deepEqual(verify({ message }), { ok: false, reason: 'bad-box' }, JSON.stringify(message));
  // Exactly four times the icon is the largest plausible box (a transformed ancestor inflates it).
  const max = { box: { x: 100, y: 50, width: ICON_WIDTH * BOX_MAX_FACTOR, height: ICON_HEIGHT * BOX_MAX_FACTOR } };
  assert.deepEqual(verify({ message: max }), { ok: true });
  assert.equal(readBox({ box: { x: 1, y: 2, width: 3, height: 4 } }).width, 3);
});

test('outside-box: the press AND the release must both be inside; a press on the icon with the release off it is refused', () => {
  const off = { x: 400, y: 400 };
  assert.deepEqual(verify({ record: clickRecord(1000, off) }), { ok: false, reason: 'outside-box' });
  assert.deepEqual(
    verify({ record: { leftDown: { ...IN_BOX, t: 1000 }, leftUp: { ...off, t: 1050 }, rightDown: null } }),
    { ok: false, reason: 'outside-box' },
    'release off the icon'
  );
  assert.deepEqual(
    verify({ record: { leftDown: { ...off, t: 1000 }, leftUp: { ...IN_BOX, t: 1050 }, rightDown: null } }),
    { ok: false, reason: 'outside-box' },
    'press off the icon'
  );
});

test('the box is scaled by the LIVE zoom factor, with the stated tolerance, at zoom 1, 1.5 and 0.67', () => {
  for (const zoom of [1, 1.5, 0.67]) {
    // The view-local point of a click at the icon's centre: clientX x zoom.
    const cx = (BOX.x + BOX.width / 2) * zoom;
    const cy = (BOX.y + BOX.height / 2) * zoom;
    assert.deepEqual(verify({ zoom, record: clickRecord(1000, { x: cx, y: cy }) }), { ok: true }, `centre at ${zoom}`);
    // Rounding of clientX to an integer is within tolerance.
    assert.deepEqual(verify({ zoom, record: clickRecord(1000, { x: Math.round(cx) + 1, y: Math.round(cy) }) }), {
      ok: true
    });
    // The unscaled box would NOT contain the scaled point (the live factor is what matters)...
    const right = (BOX.x + BOX.width) * zoom;
    const justOutside = { x: right + BOX_TOLERANCE_PX + 0.5, y: cy };
    assert.deepEqual(
      verify({ zoom, record: clickRecord(1000, justOutside) }),
      { ok: false, reason: 'outside-box' },
      `just outside at ${zoom}`
    );
    const justInside = { x: right + BOX_TOLERANCE_PX, y: cy };
    assert.deepEqual(
      verify({ zoom, record: clickRecord(1000, justInside) }),
      { ok: true },
      `tolerance edge at ${zoom}`
    );
  }
  // Zoom changed between the click and the message: a click recorded at zoom 1 against a message verified
  // at zoom 1.5 lands outside the scaled box.
  assert.deepEqual(verify({ zoom: 1.5, record: clickRecord(1000, IN_BOX) }), { ok: false, reason: 'outside-box' });
  // A garbage zoom falls back to 1 rather than throwing.
  for (const zoom of [0, -1, NaN, undefined, null]) assert.deepEqual(verify({ zoom }), { ok: true });
});

test('rate: one accepted gesture per interval; allowed again once the interval has passed', () => {
  assert.deepEqual(verify({ lastAcceptedAt: 1200 - (RATE_INTERVAL_MS - 1) }), { ok: false, reason: 'rate' });
  assert.deepEqual(verify({ lastAcceptedAt: 1200 - RATE_INTERVAL_MS }), { ok: true });
  assert.deepEqual(verify({ lastAcceptedAt: null }), { ok: true });
});

test('icon-menu: a right-button PRESS inside the box and the window; a left click or a stale press does not count', () => {
  const right = (t, pt = IN_BOX) => ({ leftDown: null, leftUp: null, rightDown: { ...pt, t } });
  const menu = (over = {}) => verify({ kind: 'icon-menu', record: right(1000), ...over });
  assert.deepEqual(menu(), { ok: true });
  assert.deepEqual(
    menu({ record: clickRecord(1000) }),
    { ok: false, reason: 'no-real-input' },
    'a LEFT click is not a right press'
  );
  assert.deepEqual(menu({ now: 1000 + WITNESS_WINDOW_MS + 1 }), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(menu({ record: right(1000, { x: 5, y: 5 }) }), { ok: false, reason: 'outside-box' });
  assert.deepEqual(menu({ message: {} }), { ok: false, reason: 'bad-box' });
  assert.deepEqual(menu({ origin: null }), { ok: false, reason: 'origin' });
  assert.deepEqual(menu({ lastAcceptedAt: 1100 }), { ok: false, reason: 'rate' });
  // A press only: a release is not required (the platform decides whether contextmenu fires on press or release).
  assert.deepEqual(menu({ record: right(1000) }), { ok: true });
});

test('committedOriginOf (NF12): a tuple http(s) origin only; error pages and every other scheme yield nothing', () => {
  assert.equal(committedOriginOf('https://Example.com/a?b#c'), 'https://example.com');
  assert.equal(committedOriginOf('http://host:8080/x'), 'http://host:8080');
  assert.equal(
    committedOriginOf('https://user:pw@example.com:443/'),
    'https://example.com',
    'userinfo and default port dropped'
  );
  for (const url of [
    'chrome-error://chromewebdata/',
    'about:blank',
    'file:///etc/hosts',
    'data:text/html,hi',
    'blob:https://example.com/uuid',
    'goldfinch://settings',
    'javascript:1',
    'ftp://example.com/',
    '',
    'not a url',
    null,
    undefined,
    5
  ]) {
    assert.equal(committedOriginOf(url), null, String(url));
  }
});

test('destinationDisplay: punycode host, a non-default port, http keeps its scheme, https shows none, anything else is empty', () => {
  assert.equal(destinationDisplay('https://example.com'), 'example.com');
  assert.equal(destinationDisplay('https://example.com:8443'), 'example.com:8443');
  assert.equal(destinationDisplay('https://example.com:443'), 'example.com', 'default port is not shown');
  assert.equal(destinationDisplay('http://example.com'), 'http://example.com');
  assert.equal(destinationDisplay('http://localhost:3000'), 'http://localhost:3000');
  // An IDN host is shown as the URL parser serialises it (punycode), never as the Unicode look-alike.
  assert.equal(destinationDisplay('https://bücher.example'), 'xn--bcher-kva.example');
  assert.equal(destinationDisplay('https://аррӏе.com').startsWith('xn--'), true, 'a Cyrillic look-alike is punycode');
  assert.equal(destinationDisplay('http://[::1]:8080'), 'http://[::1]:8080');
  for (const origin of ['', null, undefined, 5, 'file:///x', 'about:blank', 'goldfinch://settings', 'not a url']) {
    assert.equal(destinationDisplay(origin), '', String(origin));
  }
});
