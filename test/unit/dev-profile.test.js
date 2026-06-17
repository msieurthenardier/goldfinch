'use strict';
// Unit tests for devUserDataPath (src/shared/dev-profile.js).
// Pins the DD1 dev-profile-isolation derivation contract and the electron-free invariant.
// The live cross-profile runtime isolation check is leg 7's (verify-integration) responsibility —
// this helper is verified offline by derivation + a no-electron-import assertion.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { devUserDataPath } = require('../../src/shared/dev-profile');

describe('devUserDataPath', () => {
  it('appends -dev to the final segment of a representative POSIX path', () => {
    assert.equal(devUserDataPath('/home/u/.config/goldfinch'), '/home/u/.config/goldfinch-dev');
  });

  it('a single trailing separator yields the same single -dev suffix', () => {
    assert.equal(devUserDataPath('/home/u/.config/goldfinch/'), '/home/u/.config/goldfinch-dev');
  });

  it('a doubled trailing separator yields exactly one -dev suffix with no stray separator', () => {
    // The case the `+` quantifier fixes: `…/goldfinch//` must NOT become `…/goldfinch/-dev`.
    assert.equal(devUserDataPath('/home/u/.config/goldfinch//'), '/home/u/.config/goldfinch-dev');
  });

  it('a Windows-style path gets -dev on the final segment', () => {
    assert.equal(
      devUserDataPath('C:\\Users\\u\\AppData\\Roaming\\goldfinch'),
      'C:\\Users\\u\\AppData\\Roaming\\goldfinch-dev'
    );
  });

  it('a Windows-style path with a trailing backslash collapses to one -dev suffix', () => {
    assert.equal(
      devUserDataPath('C:\\Users\\u\\AppData\\Roaming\\goldfinch\\'),
      'C:\\Users\\u\\AppData\\Roaming\\goldfinch-dev'
    );
  });

  it('the helper source contains no require(\'electron\') (pins the DD1 electron-free invariant)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/shared/dev-profile.js'), 'utf8');
    assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(src), false);
  });
});
