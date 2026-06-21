'use strict';

// Unit tests for src/main/downloads-payload.js
//
// The builders take an INJECTED ACCESSOR BAG (the live DownloadItem's methods in prod,
// fakes here) — mirroring the makeFakeStore injection pattern from downloads-manager.test.js.
// These tests discriminate the two Flight-5 HAT-fix reads:
//   1. filename = basename(getSavePath()) — NOT getFilename() (the suggested name).
//   2. paused = isPaused() — NOT derived from getState() (which stays 'progressing' when paused).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  displayFilename,
  buildRegisterRecord,
  buildProgressPayload,
  buildDonePayload
} = require('../../src/main/downloads-payload');

// A plain object of fake DownloadItem accessors. Overrides replace the defaults; pass
// `getMimeType: undefined` won't drop the key, so to test an ABSENT accessor we build the
// bag explicitly in that case.
function makeFakeItem(overrides = {}) {
  return {
    getSavePath: () => '/dl/file.bin',
    getFilename: () => 'suggested.bin', // present but should NEVER be the display name
    isPaused: () => false,
    getState: () => 'progressing',
    getReceivedBytes: () => 0,
    getTotalBytes: () => 0,
    getMimeType: () => undefined,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// filename = basename(getSavePath()), NOT getFilename() — incl. deduped " (1)"
// ---------------------------------------------------------------------------
test('displayFilename uses basename(getSavePath()), differing from getFilename() (deduped " (1)")', () => {
  const item = makeFakeItem({
    getSavePath: () => '/dl/report (1).pdf', // the deduped on-disk name
    getFilename: () => 'report.pdf' // the original suggested name (must NOT win)
  });
  assert.equal(displayFilename(item), 'report (1).pdf');
  assert.notEqual(displayFilename(item), item.getFilename());

  const record = buildRegisterRecord(item, { url: 'https://e/r', startTime: 1 });
  assert.equal(record.filename, 'report (1).pdf');
});

test('displayFilename on a bare filename (no dir) returns it unchanged', () => {
  const item = makeFakeItem({ getSavePath: () => 'bare.txt' });
  assert.equal(displayFilename(item), 'bare.txt');
});

// ---------------------------------------------------------------------------
// paused = isPaused(), decoupled from getState() (stays 'progressing' when paused)
// ---------------------------------------------------------------------------
test('progress paused === isPaused() true while getState() is "progressing"', () => {
  const item = makeFakeItem({ getState: () => 'progressing', isPaused: () => true });
  const payload = buildProgressPayload(item, { id: 1, url: 'https://e/x', state: 'progressing' });
  assert.equal(payload.paused, true);
});

test('progress paused === isPaused() false while getState() is "progressing"', () => {
  const item = makeFakeItem({ getState: () => 'progressing', isPaused: () => false });
  const payload = buildProgressPayload(item, { id: 1, url: 'https://e/x', state: 'progressing' });
  assert.equal(payload.paused, false);
});

test('progress paused is undefined when isPaused accessor is absent (matches optional-call)', () => {
  const item = {
    getSavePath: () => '/dl/x.bin',
    getReceivedBytes: () => 1,
    getTotalBytes: () => 2
    // isPaused intentionally absent
  };
  const payload = buildProgressPayload(item, { id: 1, url: 'https://e/x', state: 'progressing' });
  assert.equal(payload.paused, undefined);
});

// ---------------------------------------------------------------------------
// progress assembly — every field, incl. passed-in id/url
// ---------------------------------------------------------------------------
test('buildProgressPayload assembles { id, url, filename, state, received, total, paused }', () => {
  const item = makeFakeItem({
    getSavePath: () => '/dl/movie.mp4',
    getReceivedBytes: () => 4096,
    getTotalBytes: () => 8192,
    isPaused: () => false
  });
  const payload = buildProgressPayload(item, { id: 42, url: 'https://e/v', state: 'progressing' });
  assert.deepEqual(payload, {
    id: 42,
    url: 'https://e/v',
    filename: 'movie.mp4',
    state: 'progressing',
    received: 4096,
    total: 8192,
    paused: false
  });
});

// ---------------------------------------------------------------------------
// done assembly — completed → real savePath; non-completed → null (getSavePath not called)
// ---------------------------------------------------------------------------
test('buildDonePayload completed branch uses the real getSavePath()', () => {
  const item = makeFakeItem({ getSavePath: () => '/dl/x.bin' });
  const payload = buildDonePayload(item, { id: 3, url: 'https://e/d', state: 'completed' });
  assert.deepEqual(payload, {
    id: 3,
    url: 'https://e/d',
    filename: 'x.bin',
    state: 'completed',
    savePath: '/dl/x.bin'
  });
});

test('buildDonePayload non-completed branch yields savePath null', () => {
  // getSavePath throws if called — proves the non-completed branch does NOT read it for savePath.
  let savePathCalls = 0;
  const item = makeFakeItem({
    getSavePath: () => {
      savePathCalls += 1;
      return '/dl/should-not-be-savepath.bin';
    }
  });
  const payload = buildDonePayload(item, { id: 4, url: 'https://e/i', state: 'interrupted' });
  assert.equal(payload.savePath, null);
  assert.equal(payload.state, 'interrupted');
  // getSavePath IS still called once (for the display filename), but never for savePath.
  assert.equal(savePathCalls, 1);
});

// ---------------------------------------------------------------------------
// register record shape — { url, filename, savePath, mime, startTime }; mime present/absent
// ---------------------------------------------------------------------------
test('buildRegisterRecord assembles the manager.register shape with mime present', () => {
  const item = makeFakeItem({
    getSavePath: () => '/dl/doc.pdf',
    getMimeType: () => 'application/pdf'
  });
  const record = buildRegisterRecord(item, { url: 'https://e/p', startTime: 1234 });
  assert.deepEqual(record, {
    url: 'https://e/p',
    filename: 'doc.pdf',
    savePath: '/dl/doc.pdf',
    mime: 'application/pdf',
    startTime: 1234
  });
});

test('buildRegisterRecord yields mime undefined when getMimeType accessor is absent', () => {
  const item = {
    getSavePath: () => '/dl/no-mime.bin'
    // getMimeType intentionally absent — matches today's item.getMimeType?.() === undefined
  };
  const record = buildRegisterRecord(item, { url: 'https://e/n', startTime: 5 });
  assert.deepEqual(record, {
    url: 'https://e/n',
    filename: 'no-mime.bin',
    savePath: '/dl/no-mime.bin',
    mime: undefined,
    startTime: 5
  });
});
