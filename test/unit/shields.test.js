'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Stub must be installed BEFORE requiring shields (shields.js calls require('electron') at load time).
require('../helpers/electron-stub');
const shields = require('../../src/main/shields');

// ---------------------------------------------------------------------------
// isTrackingParam
// ---------------------------------------------------------------------------
test('isTrackingParam: gclid is a tracking param', () => {
  assert.equal(shields.isTrackingParam('gclid'), true);
});

test('isTrackingParam: utm_source prefix is a tracking param', () => {
  assert.equal(shields.isTrackingParam('utm_source'), true);
});

test('isTrackingParam: hsa_ prefix is a tracking param', () => {
  assert.equal(shields.isTrackingParam('hsa_x'), true);
});

test('isTrackingParam: pk_ prefix is a tracking param', () => {
  assert.equal(shields.isTrackingParam('pk_y'), true);
});

test('isTrackingParam: mtm_ prefix is a tracking param', () => {
  assert.equal(shields.isTrackingParam('mtm_z'), true);
});

test('isTrackingParam: GCLID is case-insensitive → true', () => {
  assert.equal(shields.isTrackingParam('GCLID'), true);
});

test('isTrackingParam: q is not a tracking param', () => {
  assert.equal(shields.isTrackingParam('q'), false);
});

// ---------------------------------------------------------------------------
// stripUrl
// ---------------------------------------------------------------------------
test('stripUrl: mixed URL preserves non-tracking params and strips tracking ones', () => {
  const result = shields.stripUrl('https://example.com/path?q=hello&utm_source=foo');
  assert.ok(result !== null, 'should return a stripped URL (not null)');
  const u = new URL(result);
  assert.equal(u.searchParams.get('q'), 'hello', 'q param should be preserved');
  assert.equal(u.searchParams.has('utm_source'), false, 'utm_source should be stripped');
});

test('stripUrl: URL with no tracking params returns null', () => {
  assert.equal(shields.stripUrl('https://example.com/path?q=hello&page=2'), null);
});

test('stripUrl: invalid URL returns null', () => {
  assert.equal(shields.stripUrl('not-a-url'), null);
});

// ---------------------------------------------------------------------------
// active
// ---------------------------------------------------------------------------
test('active: default config + valid strategy + unpaused site → true', () => {
  // Ensure defaults are in place
  shields.set({ ...shields.DEFAULTS });
  const result = shields.active('block', 'example.com');
  assert.equal(result, true);
});

test('active: paused site → false', () => {
  shields.set({ ...shields.DEFAULTS });
  shields.setPaused('paused-site.com', true);
  try {
    assert.equal(shields.active('block', 'paused-site.com'), false);
  } finally {
    shields.setPaused('paused-site.com', false);
  }
});

test('active: master enabled:false → false', () => {
  shields.set({ ...shields.DEFAULTS, enabled: false });
  try {
    assert.equal(shields.active('block', 'example.com'), false);
  } finally {
    shields.set({ ...shields.DEFAULTS });
  }
});

// ---------------------------------------------------------------------------
// isPaused
// ---------------------------------------------------------------------------
test('isPaused: site in pausedSites → true', () => {
  shields.setPaused('tracked-site.com', true);
  try {
    assert.equal(shields.isPaused('tracked-site.com'), true);
  } finally {
    shields.setPaused('tracked-site.com', false);
  }
});

test('isPaused: absent site → false', () => {
  // Ensure defaults
  shields.set({ ...shields.DEFAULTS });
  assert.equal(shields.isPaused('not-paused.com'), false);
});

test('isPaused: empty string → false', () => {
  assert.equal(shields.isPaused(''), false);
});

// ---------------------------------------------------------------------------
// F3 + F8: pausedSites shape safety (load / set / isPaused / setPaused)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const os = require('os');

function writeShieldsFixture(body) {
  const dir = path.join(os.tmpdir(), 'goldfinch-test-userdata');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'shields.json');
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

test('F3 load: null pausedSites coerces to [] and active never throws', () => {
  const file = writeShieldsFixture({ pausedSites: null });
  try {
    const cfg = shields.load();
    assert.deepEqual(cfg.pausedSites, []);
    assert.doesNotThrow(() => shields.active('block', 'x.com'));
    assert.equal(shields.active('block', 'x.com'), true);
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    shields.set({ ...shields.DEFAULTS });
  }
});

test('F3 load: string pausedSites coerces to [] (no char-split)', () => {
  const file = writeShieldsFixture({ pausedSites: 'ab' });
  try {
    const cfg = shields.load();
    assert.deepEqual(cfg.pausedSites, []);
    assert.equal(shields.isPaused('a'), false);
    assert.equal(shields.isPaused('b'), false);
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    shields.set({ ...shields.DEFAULTS });
  }
});

test('F8 set: non-array pausedSites does not corrupt state into single chars', () => {
  shields.set({ ...shields.DEFAULTS });
  shields.set({ pausedSites: 'ab' });
  const sites = shields.get().pausedSites;
  assert.ok(Array.isArray(sites), 'pausedSites must remain an array');
  assert.deepEqual(sites, []);
  assert.equal(sites.includes('a'), false);
  assert.equal(sites.includes('b'), false);
  // isPaused / active must not throw
  assert.doesNotThrow(() => shields.isPaused('a'));
  assert.doesNotThrow(() => shields.active('block', 'x.com'));
});

test('F3+F8 setPaused after a bad pausedSites value keeps a proper array', () => {
  shields.set({ ...shields.DEFAULTS });
  shields.set({ pausedSites: 'ab' });
  shields.setPaused('safe.example.com', true);
  try {
    const sites = shields.get().pausedSites;
    assert.ok(Array.isArray(sites));
    assert.deepEqual(sites, ['safe.example.com']);
    assert.equal(shields.isPaused('safe.example.com'), true);
    assert.equal(shields.isPaused('a'), false);
  } finally {
    shields.setPaused('safe.example.com', false);
    shields.set({ ...shields.DEFAULTS });
  }
});

test('F8 set: unknown keys and wrong-typed flags are ignored', () => {
  shields.set({ ...shields.DEFAULTS });
  shields.set({ enabled: 'nope', notAKey: true, block: false });
  const cfg = shields.get();
  assert.equal(cfg.enabled, true, 'wrong-typed enabled must not apply');
  assert.equal(cfg.block, false, 'boolean block must apply');
  assert.equal(Object.hasOwn(cfg, 'notAKey'), false);
  shields.set({ ...shields.DEFAULTS });
});
