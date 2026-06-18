'use strict';
// Unit tests for the pure dev/bind gates in src/shared/automation-dev.js:
// isMcpAutomationEnabled, shouldAutoMint, and shouldBindAutomation
// (Flight 8 / DD2 — the toggle-binds decision predicate).
// engine.js / the dev seam (main.js handler + preload method) are integration-verified in
// Leg 6 live smoke and are NOT unit-tested offline — they require the Electron runtime.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isMcpAutomationEnabled,
  shouldAutoMint,
  shouldBindAutomation,
} = require('../../src/shared/automation-dev');

describe('isMcpAutomationEnabled (the MCP dev gate, DD4)', () => {
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

describe('shouldAutoMint (dev auto-mint double gate, Leg 5)', () => {
  const ARGV = ['/path/to/electron', '.', '--automation-dev'];

  // --- true ONLY when BOTH gates hold ---

  it('returns true when --automation-dev AND GOLDFINCH_AUTOMATION_DEV_MINT === "1"', () => {
    assert.equal(shouldAutoMint(ARGV, { GOLDFINCH_AUTOMATION_DEV_MINT: '1' }), true);
  });

  it('ignores unrelated env keys when both gates hold', () => {
    assert.equal(
      shouldAutoMint(ARGV, { GOLDFINCH_AUTOMATION_DEV_MINT: '1', GOLDFINCH_AUTOMATION_ADMIN: '1', FOO: 'bar' }),
      true
    );
  });

  // --- CRITICAL: false when EITHER gate is missing ---

  it('returns FALSE when --automation-dev is present but the env var is unset (plain dev:automation stays inert)', () => {
    assert.equal(shouldAutoMint(ARGV, {}), false);
  });

  it('returns FALSE when the env var is set but --automation-dev is absent (no surface to mint into)', () => {
    assert.equal(shouldAutoMint(['electron', '.'], { GOLDFINCH_AUTOMATION_DEV_MINT: '1' }), false);
  });

  // --- env var must be EXACTLY '1' ---

  it('returns FALSE when GOLDFINCH_AUTOMATION_DEV_MINT is a non-"1" truthy value', () => {
    assert.equal(shouldAutoMint(ARGV, { GOLDFINCH_AUTOMATION_DEV_MINT: 'true' }), false);
    assert.equal(shouldAutoMint(ARGV, { GOLDFINCH_AUTOMATION_DEV_MINT: 'yes' }), false);
    assert.equal(shouldAutoMint(ARGV, { GOLDFINCH_AUTOMATION_DEV_MINT: '0' }), false);
    assert.equal(shouldAutoMint(ARGV, { GOLDFINCH_AUTOMATION_DEV_MINT: '' }), false);
  });

  // --- robustness ---

  it('returns false and never throws for missing / non-object env', () => {
    assert.equal(shouldAutoMint(ARGV, undefined), false);
    assert.equal(shouldAutoMint(ARGV, null), false);
    assert.doesNotThrow(() => shouldAutoMint(ARGV, undefined));
    assert.doesNotThrow(() => shouldAutoMint(null, null));
  });

  it('returns false for non-array argv even with the env var set', () => {
    assert.equal(shouldAutoMint(null, { GOLDFINCH_AUTOMATION_DEV_MINT: '1' }), false);
    assert.equal(shouldAutoMint('--automation-dev', { GOLDFINCH_AUTOMATION_DEV_MINT: '1' }), false);
  });
});

describe('shouldBindAutomation (toggle-binds decision predicate, Flight 8 / DD2)', () => {
  // --- true when EITHER term holds ---

  it('returns true when automationEnabled === true (production toggle on)', () => {
    assert.equal(shouldBindAutomation({ automationEnabled: true, devForceBind: false }), true);
  });

  it('returns true when devForceBind === true (dev force-bind, toggle off)', () => {
    assert.equal(shouldBindAutomation({ automationEnabled: false, devForceBind: true }), true);
  });

  it('returns true when both terms are true', () => {
    assert.equal(shouldBindAutomation({ automationEnabled: true, devForceBind: true }), true);
  });

  // --- false when NEITHER term holds (the both-false case) ---

  it('returns false when both terms are false (packaged build, toggle off, no dev flag)', () => {
    assert.equal(shouldBindAutomation({ automationEnabled: false, devForceBind: false }), false);
  });

  // --- strict-equality discipline: only the genuine boolean true binds ---

  it('returns false for truthy non-boolean automationEnabled (strict === true)', () => {
    assert.equal(shouldBindAutomation({ automationEnabled: 1, devForceBind: false }), false);
    assert.equal(shouldBindAutomation({ automationEnabled: 'true', devForceBind: false }), false);
  });

  it('returns false for truthy non-boolean devForceBind (strict === true)', () => {
    assert.equal(shouldBindAutomation({ automationEnabled: false, devForceBind: 1 }), false);
  });

  it('defaults missing terms to undefined → false, and never throws on no args', () => {
    assert.equal(shouldBindAutomation({}), false);
    assert.equal(shouldBindAutomation(), false);
    assert.doesNotThrow(() => shouldBindAutomation());
  });
});
