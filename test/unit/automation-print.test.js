'use strict';

// Unit tests for src/main/automation/print.js (the automation printToPDF op).
//
// Electron-free: print.js does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub. Fake wc / fromId /
// activate / printToPDF stand in for the real Electron handles. Mirrors the
// observe base64-op test style (foreground-first ordering + base64 return).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { printToPDF } = require('../../src/main/automation/print');

// Fake wc whose printToPDF() resolves a known Buffer so the base64 is
// deterministic — Buffer.from('PDFBYTES').toString('base64').
const PDF_BYTES = 'PDFBYTES';
const EXPECTED_B64 = Buffer.from(PDF_BYTES).toString('base64');

function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
    /** @type {number} */
    _printCount: 0,
    /** @type {any} */
    _opts: undefined,
    async printToPDF(opts) { this._printCount += 1; this._opts = opts; return Buffer.from(PDF_BYTES); },
  };
}

function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
    _printCount: 0,
    _opts: undefined,
    async printToPDF(opts) { this._printCount += 1; this._opts = opts; return Buffer.from(PDF_BYTES); },
  };
}

/**
 * Build a fake fromId lookup backed by a map of id → fake wc.
 * @param {Record<number, object>} map
 */
function makeFakeFromId(map) {
  return (/** @type {number} */ id) => map[id] ?? null;
}

// ---------------------------------------------------------------------------
// printToPDF — base64 return shape
// ---------------------------------------------------------------------------

test('printToPDF: returns the base64 of the PDF buffer (a string)', async () => {
  const guestWc = makeGuestWc(60);
  const deps = {
    fromId: makeFakeFromId({ 60: guestWc }),
    chromeContents: null,
    activate: async () => {},
  };

  const result = await printToPDF(60, deps);

  assert.equal(result, EXPECTED_B64);
  assert.equal(typeof result, 'string');
  assert.deepEqual(guestWc._opts, {}, 'printToPDF called with the required options arg ({})');
});

// ---------------------------------------------------------------------------
// printToPDF — foreground-first: activate BEFORE printToPDF, re-resolved handle
// ---------------------------------------------------------------------------

test('printToPDF: guest — activate called BEFORE printToPDF (ordering via callLog) and post-activate re-resolve handle is used', async () => {
  const callLog = [];
  const preWc = makeGuestWc(70);
  // A DISTINCT post-activate handle so we can prove the re-resolved one is used.
  const postWc = makeGuestWc(70);

  preWc.printToPDF = async () => { callLog.push('print:pre'); return Buffer.from(PDF_BYTES); };
  postWc.printToPDF = async () => { callLog.push('print:post'); return Buffer.from(PDF_BYTES); };

  let resolved = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 70) return null;
    resolved += 1;
    return resolved === 1 ? preWc : postWc; // first resolve → pre, after activate → post
  };
  const activate = async () => { callLog.push('activate'); };

  const result = await printToPDF(70, { fromId, chromeContents: null, activate });

  assert.equal(result, EXPECTED_B64);
  assert.deepEqual(callLog, ['activate', 'print:post'], 'activate runs before printToPDF, and the re-resolved (post-activate) handle is printed');
});

// ---------------------------------------------------------------------------
// printToPDF — op-local internal guard holds EVEN under admin (allowInternal)
// ---------------------------------------------------------------------------

test('printToPDF: refuses an internal wc even when deps.allowInternal === true (op-local guard before activate)', async () => {
  const internalWc = makeInternalWc(80);
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 80: internalWc }),
    chromeContents: null,
    allowInternal: true, // admin relaxation — resolveContents would let internal through
    activate: async (/** @type {number} */ id) => { activateCalls.push(id); },
  };

  await assert.rejects(
    () => printToPDF(80, deps),
    /automation: printToPDF — internal-session excluded/,
  );
  assert.equal(activateCalls.length, 0, 'internal wc must be refused BEFORE activate (foregrounding) is attempted');
  assert.equal(internalWc._printCount, 0, 'printToPDF must NOT be called on the internal-session path');
});

// ---------------------------------------------------------------------------
// printToPDF — resolve-time rejections surface through resolveContents
// ---------------------------------------------------------------------------

test('printToPDF: bad-handle — non-number wcId rejects via resolveContents', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null, activate: async () => {} };
  await assert.rejects(
    () => printToPDF(/** @type {any} */ ('nope'), deps),
    /automation: bad-handle/,
  );
});

test('printToPDF: no-such-contents — unknown wcId rejects via resolveContents', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null, activate: async () => {} };
  await assert.rejects(
    () => printToPDF(999, deps),
    /automation: no-such-contents/,
  );
});
