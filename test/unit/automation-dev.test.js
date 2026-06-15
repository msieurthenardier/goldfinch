'use strict';
// Unit tests for isAutomationDevEnabled (src/shared/automation-dev.js).
// engine.js / the dev seam (main.js handler + preload method) are integration-verified in
// Leg 6 live smoke and are NOT unit-tested offline — they require the Electron runtime.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isAutomationDevEnabled, isMcpAutomationEnabled } = require('../../src/shared/automation-dev');

describe('isAutomationDevEnabled', () => {
  // --- true cases ---

  it('returns true for --remote-debugging-port=9222', () => {
    assert.equal(isAutomationDevEnabled(['--remote-debugging-port=9222']), true);
  });

  it('returns true for --remote-debugging-port (bare, no value)', () => {
    assert.equal(isAutomationDevEnabled(['--remote-debugging-port']), true);
  });

  it('returns true for --remote-debugging-port=0 (any port value)', () => {
    assert.equal(isAutomationDevEnabled(['--remote-debugging-port=0']), true);
  });

  it('returns true for --automation-dev', () => {
    assert.equal(isAutomationDevEnabled(['--automation-dev']), true);
  });

  it('returns true when --remote-debugging-port is mixed with other args', () => {
    assert.equal(
      isAutomationDevEnabled(['node', 'main.js', '--remote-debugging-port=9222', '--some-flag']),
      true
    );
  });

  it('returns true when --automation-dev is mixed with other args', () => {
    assert.equal(
      isAutomationDevEnabled(['/path/to/electron', '.', '--automation-dev', '--no-sandbox']),
      true
    );
  });

  // --- false cases ---

  it('returns false for an empty array', () => {
    assert.equal(isAutomationDevEnabled([]), false);
  });

  it('returns false for unrelated args', () => {
    assert.equal(isAutomationDevEnabled(['node', 'main.js', '--some-flag', '--another']), false);
  });

  it('returns false for --remote-debugging-port as a substring of another flag', () => {
    // Must start-with the flag, but only if the arg itself starts with it.
    // e.g. '--not-remote-debugging-port' does NOT start with '--remote-debugging-port'
    assert.equal(isAutomationDevEnabled(['--not-remote-debugging-port=9222']), false);
  });

  it('returns false for an arg that is a prefix of --automation-dev (must be exact)', () => {
    assert.equal(isAutomationDevEnabled(['--automation-dev-extra']), false);
    assert.equal(isAutomationDevEnabled(['--automation-de']), false);
  });

  it('returns false for null', () => {
    assert.equal(isAutomationDevEnabled(null), false);
  });

  it('returns false for undefined', () => {
    assert.equal(isAutomationDevEnabled(undefined), false);
  });

  it('returns false for a string (non-array)', () => {
    assert.equal(isAutomationDevEnabled('--automation-dev'), false);
  });

  it('returns false for a number (non-array)', () => {
    assert.equal(isAutomationDevEnabled(42), false);
  });

  it('returns false for an object (non-array)', () => {
    assert.equal(isAutomationDevEnabled({ 0: '--automation-dev', length: 1 }), false);
  });

  it('never throws for any input', () => {
    assert.doesNotThrow(() => isAutomationDevEnabled(null));
    assert.doesNotThrow(() => isAutomationDevEnabled(undefined));
    assert.doesNotThrow(() => isAutomationDevEnabled({}));
    assert.doesNotThrow(() => isAutomationDevEnabled([]));
    assert.doesNotThrow(() => isAutomationDevEnabled([null, undefined, 42, true]));
  });

  it('skips non-string elements in an array without throwing', () => {
    // Array with a mix: a non-string followed by the target flag.
    assert.equal(isAutomationDevEnabled([null, undefined, 42, '--automation-dev']), true);
    // Array with only non-strings — returns false, does not throw.
    assert.equal(isAutomationDevEnabled([null, 42, true, {}]), false);
  });
});

describe('isMcpAutomationEnabled (narrower MCP gate, DD4)', () => {
  // --- true ONLY for the exact --automation-dev token ---

  it('returns true for --automation-dev', () => {
    assert.equal(isMcpAutomationEnabled(['--automation-dev']), true);
  });

  it('returns true when --automation-dev is mixed with other args', () => {
    assert.equal(
      isMcpAutomationEnabled(['/path/to/electron', '.', '--enable-logging', '--no-sandbox', '--automation-dev']),
      true
    );
  });

  // --- CRITICAL: false for the CDP port (structural decoupling) ---

  it('returns FALSE for a bare --remote-debugging-port (the CDP-decoupling invariant)', () => {
    assert.equal(isMcpAutomationEnabled(['--remote-debugging-port']), false);
  });

  it('returns FALSE for --remote-debugging-port=9222 (dev:debug must NOT start the MCP server)', () => {
    assert.equal(
      isMcpAutomationEnabled(['electron', '.', '--remote-debugging-port=9222', '--remote-allow-origins=*']),
      false
    );
  });

  // --- other false cases ---

  it('returns false for an empty array', () => {
    assert.equal(isMcpAutomationEnabled([]), false);
  });

  it('returns false for unrelated args', () => {
    assert.equal(isMcpAutomationEnabled(['node', 'main.js', '--enable-logging']), false);
  });

  it('returns false for a prefix of --automation-dev (must be the exact token)', () => {
    assert.equal(isMcpAutomationEnabled(['--automation-dev-extra']), false);
    assert.equal(isMcpAutomationEnabled(['--automation-de']), false);
  });

  it('returns false for null / undefined / non-array inputs', () => {
    assert.equal(isMcpAutomationEnabled(null), false);
    assert.equal(isMcpAutomationEnabled(undefined), false);
    assert.equal(isMcpAutomationEnabled('--automation-dev'), false);
    assert.equal(isMcpAutomationEnabled(42), false);
    assert.equal(isMcpAutomationEnabled({ 0: '--automation-dev', length: 1 }), false);
  });

  it('never throws for any input', () => {
    assert.doesNotThrow(() => isMcpAutomationEnabled(null));
    assert.doesNotThrow(() => isMcpAutomationEnabled(undefined));
    assert.doesNotThrow(() => isMcpAutomationEnabled({}));
    assert.doesNotThrow(() => isMcpAutomationEnabled([null, undefined, 42, true]));
  });
});
