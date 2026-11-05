'use strict';

// Sortie 06 Leg 1 (AC1): the pure per-reason close-effects table, plus the drift guards that
// keep the manager's emitted reasons and the chrome client's handled reasons subsets of it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { savePromptCloseEffects, SAVE_PROMPT_CLOSE_REASONS } = require('../../src/shared/save-prompt-close-effects');

const DD6_REASONS = [
  'saved',
  'dismissed',
  'timeout',
  'expired',
  'unlock-requested',
  'unlock-abandoned',
  'tab-switch',
  'tab-hide',
  'tab-close',
  'tab-moved',
  'teardown',
  'vault-lock'
];

test('AC1: the exported reason set is exactly the twelve DD6 reasons', () => {
  assert.deepEqual([...SAVE_PROMPT_CLOSE_REASONS].sort(), [...DD6_REASONS].sort());
});

test('AC1: every DD6 reason returns a FROZEN five-field effects row', () => {
  for (const reason of DD6_REASONS) {
    const fx = savePromptCloseEffects(reason);
    assert.ok(Object.isFrozen(fx), `${reason} row is frozen`);
    assert.deepEqual(Object.keys(fx).sort(), ['advance', 'clearQueue', 'dismissShown', 'dropTabQueue', 'refocusGuest']);
    for (const v of Object.values(fx)) assert.equal(typeof v, 'boolean');
  }
});

test('Leg 3 AC5: refocusGuest is true for saved/dismissed ONLY', () => {
  for (const reason of DD6_REASONS) {
    assert.equal(savePromptCloseEffects(reason).refocusGuest, reason === 'saved' || reason === 'dismissed', reason);
  }
});

test('AC1: unknown, undefined and prototype-member reasons map to the dismissed row (Object.hasOwn lookup)', () => {
  const dismissed = savePromptCloseEffects('dismissed');
  for (const bad of ['nope', undefined, null, 42, 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(savePromptCloseEffects(bad), dismissed, String(bad));
  }
});

test('AC1: vault-lock does not dismissShown (dropAllCaptures follows) and clears the queue', () => {
  const fx = savePromptCloseEffects('vault-lock');
  assert.equal(fx.dismissShown, false);
  assert.equal(fx.clearQueue, true);
});

test('AC1: the DD6 table rows (shown capture / queue)', () => {
  assert.deepEqual(
    { ...savePromptCloseEffects('saved') },
    {
      dismissShown: false,
      advance: true,
      dropTabQueue: false,
      clearQueue: false,
      refocusGuest: true
    }
  );
  for (const r of ['dismissed', 'timeout']) {
    assert.equal(savePromptCloseEffects(r).dismissShown, true, r);
    assert.equal(savePromptCloseEffects(r).advance, true, r);
  }
  assert.equal(savePromptCloseEffects('expired').dismissShown, false);
  assert.equal(savePromptCloseEffects('expired').advance, true);
  // unlock-requested holds the capture with consent: no dismiss, no advance, no clear.
  const ur = savePromptCloseEffects('unlock-requested');
  assert.deepEqual([ur.dismissShown, ur.advance, ur.clearQueue, ur.dropTabQueue], [false, false, false, false]);
  const ua = savePromptCloseEffects('unlock-abandoned');
  assert.deepEqual([ua.dismissShown, ua.clearQueue], [true, true]);
  for (const r of ['tab-switch', 'tab-hide', 'tab-close', 'tab-moved']) {
    const fx = savePromptCloseEffects(r);
    assert.equal(fx.dropTabQueue, true, r);
    assert.equal(fx.advance, true, r);
    assert.equal(fx.dismissShown, false, `${r}: dropCapturesForTab already dropped it`);
  }
  assert.equal(savePromptCloseEffects('teardown').clearQueue, true);
});

// ---- drift guards (source-scan flavor: they THROW rather than pass vacuously) ----------------

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

/** Every string literal passed as the first arg of `close(` / `showResult(...)` closeReason, etc. */
function collectLiterals(src, re) {
  const found = new Set();
  let m;
  while ((m = re.exec(src))) found.add(m[1]);
  if (found.size === 0) throw new Error(`drift guard collected zero reasons for ${re} - the scan is vacuous`);
  return found;
}

test('AC1 drift: every reason the MANAGER emits is in the exported set', () => {
  const src = read('src/main/save-prompt-manager.js');
  const emitted = new Set([
    ...collectLiterals(src, /\bclose\('([a-z-]+)'/g),
    ...collectLiterals(src, /closeReason: '([a-z-]+)'/g),
    ...collectLiterals(src, /SAVE_PROMPT_(?:SUCCESS|FAILURE)_HOLD_MS,\s*'([a-z-]+)'/g)
  ]);
  for (const reason of emitted)
    assert.ok(SAVE_PROMPT_CLOSE_REASONS.has(reason), `manager emits unknown reason "${reason}"`);
});

test('AC1 drift: every reason the other main-side callers pass is in the exported set', () => {
  const callers = [
    ['src/main/register-tab-ipc.js', /closeSavePromptAndDrop\([^)]*?'([a-z-]+)'/g],
    ['src/main/html-fullscreen.js', /closeSavePromptAndDrop\([^)]*?'([a-z-]+)'/g],
    ['src/main/vault-lock-teardown.js', /savePrompt\?\.close\('([a-z-]+)'/g],
    ['src/main/window-factory.js', /savePrompt\?\.close\('([a-z-]+)'/g]
  ];
  for (const [file, re] of callers) {
    for (const reason of collectLiterals(read(file), re)) {
      assert.ok(SAVE_PROMPT_CLOSE_REASONS.has(reason), `${file} passes unknown reason "${reason}"`);
    }
  }
});

test('AC1 drift: the chrome client does not hard-code reason handling - it applies the shared table (see save-prompt-client.test.js for the handled/deferred subset guard)', () => {
  const vc = read('src/renderer/chrome/vault-controller.js');
  assert.match(vc, /savePromptCloseEffects\(reason\)/);
  const client = read('src/renderer/chrome/save-prompt-client.js');
  assert.match(client, /CLIENT_HANDLED_REASONS/);
});
