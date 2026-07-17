'use strict';

// Unit tests for src/main/move-tab-payload.js (M09 F6 Leg 4 — DD5 / review H2).
//
// The rules pinned: the tab-move-to-new-window invoke carries the SOURCE
// renderer's strip snapshot (favicon + container exist only renderer-side);
// main shape-validates it fail-closed (null, never throw) and builds the
// adopt-tab payload with MAIN-AUTHORITATIVE url/title read off the live
// webContents at send time, falling back to the snapshot for a dead wc.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateMoveTabPayload, buildAdoptPayload } = require('../../src/main/move-tab-payload');

const CONTAINER = { id: 'work', name: 'Work', color: '#f00', partition: 'persist:work' };
const GOOD = { wcId: 7, url: 'https://a.example/', title: 'A', favicon: 'https://a.example/f.ico', container: CONTAINER };

// --- validateMoveTabPayload ---------------------------------------------------

test('a well-formed payload validates and normalizes to only the known fields', () => {
  const p = validateMoveTabPayload({ ...GOOD, extra: 'dropped' });
  assert.deepEqual(p, {
    wcId: 7,
    url: 'https://a.example/',
    title: 'A',
    favicon: 'https://a.example/f.ico',
    container: { id: 'work', name: 'Work', color: '#f00', partition: 'persist:work' },
  });
  assert.equal('extra' in p, false);
});

test('a burner container snapshot rides through with burner:true (H2 — burners ARE movable)', () => {
  const burner = { id: 'burner-42', name: 'Burner', color: '#999', partition: 'burner:42', burner: true };
  const p = validateMoveTabPayload({ ...GOOD, container: burner });
  assert.deepEqual(p.container, burner);
});

test('non-true burner values are dropped, not coerced (shape discipline)', () => {
  const p = validateMoveTabPayload({ ...GOOD, container: { ...CONTAINER, burner: 'yes' } });
  assert.equal('burner' in p.container, false);
});

test('container is reduced to its five known keys (no renderer-shaped extras relayed to the target chrome)', () => {
  const p = validateMoveTabPayload({ ...GOOD, container: { ...CONTAINER, evil: '<x>' } });
  assert.equal('evil' in p.container, false);
});

test('null favicon is preserved as null; omitted favicon normalizes to null', () => {
  assert.equal(validateMoveTabPayload({ ...GOOD, favicon: null }).favicon, null);
  const noFavicon = { ...GOOD };
  delete noFavicon.favicon;
  assert.equal(validateMoveTabPayload(noFavicon).favicon, null);
});

test('malformed payloads are refused with null, never a throw', () => {
  const bad = [
    null,
    undefined,
    42,
    'x',
    {},
    { ...GOOD, wcId: '7' },
    { ...GOOD, wcId: 7.5 },
    { ...GOOD, url: 42 },
    { ...GOOD, title: null },
    { ...GOOD, favicon: 42 },
    { ...GOOD, container: null },
    { ...GOOD, container: 'work' },
    { ...GOOD, container: { ...CONTAINER, partition: 42 } },
    { ...GOOD, container: { id: 'work' } },
  ];
  for (const payload of bad) {
    assert.doesNotThrow(() => {
      assert.equal(validateMoveTabPayload(payload), null, `must refuse ${JSON.stringify(payload)}`);
    });
  }
});

// --- buildAdoptPayload ----------------------------------------------------------

const liveWc = (url, title) => ({ isDestroyed: () => false, getURL: () => url, getTitle: () => title });

test('adopt payload takes MAIN-AUTHORITATIVE url/title from the live wc at send time (H2)', () => {
  const p = validateMoveTabPayload(GOOD);
  const adopt = buildAdoptPayload(p, liveWc('https://a.example/deep', 'Deep A'));
  assert.deepEqual(adopt, {
    wcId: 7,
    url: 'https://a.example/deep',
    title: 'Deep A',
    favicon: 'https://a.example/f.ico',
    container: p.container,
  });
});

test('a destroyed/absent wc falls back to the renderer snapshot url/title', () => {
  const p = validateMoveTabPayload(GOOD);
  const dead = { isDestroyed: () => true, getURL: () => 'x', getTitle: () => 'x' };
  assert.deepEqual(buildAdoptPayload(p, dead), { ...p });
  assert.deepEqual(buildAdoptPayload(p, null), { ...p });
});

test('empty live url/title fall back per-field to the snapshot (a mid-boot wc must not blank the strip)', () => {
  const p = validateMoveTabPayload(GOOD);
  const adopt = buildAdoptPayload(p, liveWc('', ''));
  assert.equal(adopt.url, 'https://a.example/');
  assert.equal(adopt.title, 'A');
});

test('favicon and container ride the snapshot verbatim — renderer-only facts main cannot rebuild', () => {
  const burner = { id: 'burner-9', name: 'Burner', color: '#999', partition: 'burner:9', burner: true };
  const p = validateMoveTabPayload({ ...GOOD, container: burner, favicon: null });
  const adopt = buildAdoptPayload(p, liveWc('https://b.example/', 'B'));
  assert.equal(adopt.favicon, null);
  assert.deepEqual(adopt.container, burner);
});
