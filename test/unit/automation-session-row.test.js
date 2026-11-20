'use strict';

// Squawk 0161: two active sessions of equal kind, name and `since` must render distinguishable rows.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { sessionIdPrefix, SESSION_ID_PREFIX_LENGTH } = require('../../src/renderer/pages/automation-session-row.js');

test('prefix is the first 8 characters of the session id', () => {
  assert.equal(SESSION_ID_PREFIX_LENGTH, 8);
  assert.equal(sessionIdPrefix('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a1b2c3d4');
});

test('two sessions equal in kind, name and since are distinguishable by prefix', () => {
  const a = { kind: 'admin', since: 1, sessionId: 'a1b2c3d4-0000' };
  const b = { kind: 'admin', since: 1, sessionId: 'ffee9988-0000' };
  assert.notEqual(sessionIdPrefix(a.sessionId), sessionIdPrefix(b.sessionId));
});

test('a short id renders whole', () => {
  assert.equal(sessionIdPrefix('abc'), 'abc');
});

test('a missing, empty or non-string id renders none', () => {
  for (const v of [undefined, null, '', 42, {}, ['abcdefgh']]) assert.equal(sessionIdPrefix(v), null);
});

test('automation.js renders the prefix as its own textContent span, only when present', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../src/renderer/pages/automation.js'), 'utf8');
  assert.match(js, /sessionIdPrefix\(s\.sessionId\)/);
  assert.match(js, /if \(idPrefix !== null\)/);
  assert.match(js, /className = 'activity-session-id muted'/);
  assert.match(js, /id\.textContent = idPrefix/);
});
