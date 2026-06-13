'use strict';
// Unit tests for isAutomationDevEnabled (src/shared/automation-dev.js).
// engine.js / the dev seam (main.js handler + preload method) are integration-verified in
// Leg 6 live smoke and are NOT unit-tested offline — they require the Electron runtime.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isAutomationDevEnabled } = require('../../src/shared/automation-dev');

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
