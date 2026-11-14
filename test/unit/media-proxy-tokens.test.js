'use strict';

// src/main/media-proxy-tokens.js — the per-tab, per-document proxy token store (Mission 23 Flight 1,
// leg `jar-isolation`). The lifecycle matrix: mint, reuse, stale frame, mint-before-commit, commit,
// reload, destroy, move.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMediaProxyTokens, TOKEN_BYTES } = require('../../src/main/media-proxy-tokens');

test('mint: a token is base64url, at least 128 bits, and resolves to its tab', () => {
  const s = createMediaProxyTokens();
  const t = s.issue(5, 'f1', 'f1');
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.ok(TOKEN_BYTES >= 16);
  assert.ok(Buffer.from(t, 'base64url').length >= 16);
  assert.equal(s.resolve(t), 5);
});

test('mint draws from the injected random source; two tabs get different tokens', () => {
  let n = 0;
  const s = createMediaProxyTokens({ randomBytes: (len) => Buffer.alloc(len, ++n) });
  const a = s.issue(1, 'f', 'f');
  const b = s.issue(2, 'g', 'g');
  assert.notEqual(a, b);
  assert.equal(a, Buffer.alloc(TOKEN_BYTES, 1).toString('base64url'));
});

test('reuse: the same document keeps its token across lists', () => {
  const s = createMediaProxyTokens();
  assert.equal(s.issue(5, 'f1', 'f1'), s.issue(5, 'f1', 'f1'));
});

test('a list from a stale frame token is dropped (null) and mints nothing', () => {
  const s = createMediaProxyTokens();
  const first = s.issue(5, 'f1', 'f1');
  assert.equal(s.issue(5, 'f-old', 'f2'), null);
  assert.equal(s.resolve(first), 5, 'the dropped list changed nothing');
  const empty = createMediaProxyTokens();
  assert.equal(empty.issue(5, 'f-old', 'f2'), null);
});

test('missing or non-string frame tokens drop the list', () => {
  const s = createMediaProxyTokens();
  for (const [a, b] of [
    [undefined, 'f'],
    ['f', undefined],
    [null, null],
    ['', ''],
    [1, 1],
    [{}, {}]
  ]) {
    assert.equal(s.issue(5, a, b), null);
  }
});

test('a new document (new frame token) gets a new token and the old one stops resolving', () => {
  const s = createMediaProxyTokens();
  const old = s.issue(5, 'f1', 'f1');
  const next = s.issue(5, 'f2', 'f2');
  assert.notEqual(old, next);
  assert.equal(s.resolve(old), null);
  assert.equal(s.resolve(next), 5);
});

test('mint-before-commit: a list from the new document that arrives before did-navigate keeps its token', () => {
  const s = createMediaProxyTokens();
  s.issue(5, 'f1', 'f1');
  const fresh = s.issue(5, 'f2', 'f2'); // the new document's list, ahead of the commit event
  s.onCommit(5, 'f2');
  assert.equal(s.resolve(fresh), 5);
});

test('commit: did-navigate invalidates a token minted for the previous document', () => {
  const s = createMediaProxyTokens();
  const t = s.issue(5, 'f1', 'f1');
  s.onCommit(5, 'f2');
  assert.equal(s.resolve(t), null);
  assert.equal(s.issue(5, 'f1', 'f2'), null, 'the old document cannot get a token after the commit either');
  assert.ok(s.issue(5, 'f2', 'f2'));
});

test('commit with an unreadable current frame token fails closed', () => {
  const s = createMediaProxyTokens();
  const t = s.issue(5, 'f1', 'f1');
  s.onCommit(5, undefined);
  assert.equal(s.resolve(t), null);
});

test('reload: a reload commits a new document, so the token is replaced', () => {
  const s = createMediaProxyTokens();
  const t = s.issue(5, 'f1', 'f1');
  s.onCommit(5, 'f1-reloaded');
  assert.equal(s.resolve(t), null);
  const t2 = s.issue(5, 'f1-reloaded', 'f1-reloaded');
  assert.notEqual(t, t2);
});

test('commit on a tab with no token is a no-op', () => {
  const s = createMediaProxyTokens();
  assert.doesNotThrow(() => s.onCommit(9, 'f'));
});

test('destroy: forget drops the tab and its reverse entry; other tabs are untouched', () => {
  const s = createMediaProxyTokens();
  const a = s.issue(5, 'f1', 'f1');
  const b = s.issue(6, 'g1', 'g1');
  s.forget(5);
  assert.equal(s.resolve(a), null);
  assert.equal(s.resolve(b), 6);
  assert.doesNotThrow(() => s.forget(5));
});

test('move: the token is keyed by the webContents, so it survives a window move (no hook fires)', () => {
  const s = createMediaProxyTokens();
  const t = s.issue(5, 'f1', 'f1');
  // A move re-parents the same webContents: no commit, no destroy.
  assert.equal(s.resolve(t), 5);
  assert.equal(s.issue(5, 'f1', 'f1'), t);
});

test('resolve: unknown, non-string, decimal tab-number and prototype-key lookups all answer null', () => {
  const s = createMediaProxyTokens();
  s.issue(28, 'f', 'f');
  for (const bad of ['28', 28, null, undefined, '', 'AAAAAAAAAAAAAAAAAAAAAA', '__proto__', 'constructor', {}]) {
    assert.equal(s.resolve(bad), null, String(bad));
  }
});
