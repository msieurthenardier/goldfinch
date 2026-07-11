'use strict';
// Unit tests for src/main/auto-mint.js: resolveAutoMintTarget (dev auto-mint target
// resolution, M06 F2 DD7). Moved verbatim from automation-dev.test.js in the flight-02
// ESM-conversion divert — the function moved main-side so the preload-reachable
// automation-dev.js could drop its require of the converted ESM burner.js.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { resolveAutoMintTarget } = require('../../src/main/auto-mint');
const { BURNER } = require('../../src/shared/burner');

describe('resolveAutoMintTarget (dev auto-mint target resolution, M06 F2 DD7)', () => {
  it('returns the default jar id when the default is a real jar', () => {
    assert.equal(resolveAutoMintTarget({ getDefault: () => ({ id: 'personal' }) }), 'personal');
  });

  it('returns null for the frozen BURNER sentinel (empty registry)', () => {
    assert.equal(resolveAutoMintTarget({ getDefault: () => BURNER }), null);
  });

  it('returns null for a burner-id-shaped object even without reference identity (id-compare, not reference-compare)', () => {
    assert.equal(resolveAutoMintTarget({ getDefault: () => ({ id: 'burner', name: 'Burner', color: '#ff8c42' }) }), null);
  });

  it('returns the legacy default jar id (migrated profile)', () => {
    assert.equal(resolveAutoMintTarget({ getDefault: () => ({ id: 'default' }) }), 'default');
  });
});
