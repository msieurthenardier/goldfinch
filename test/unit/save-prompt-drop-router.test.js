'use strict';

// Sortie 06 Leg 1 (AC14): the drop router - routes vault-human's onCaptureDropped metadata to the
// owning window's manager (always) and owner-routes `vault-capture-dropped` to that tab's chrome
// (only when `offered`). Quiet on a null owner / manager / chrome.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { routeCaptureDropped } = require('../../src/main/save-prompt-drop-router');

function fakes({ manager = true, chrome = true, destroyed = false } = {}) {
  const log = [];
  return {
    log,
    deps: {
      managerForTab: (wcId) => {
        log.push(['managerForTab', wcId]);
        return manager ? { onCaptureDropped: (arg) => log.push(['manager', arg]) } : null;
      },
      chromeForTab: (wcId) => {
        log.push(['chromeForTab', wcId]);
        return chrome ? { isDestroyed: () => destroyed, send: (c, p) => log.push(['chrome', c, p]) } : null;
      }
    }
  };
}

test('AC14: an offered drop reaches the manager (with cause) AND the owning chrome as vault-capture-dropped { captureId }', () => {
  const f = fakes();
  routeCaptureDropped({ captureId: 'c1', wcId: 7, offered: true, cause: 'superseded' }, f.deps);
  assert.deepEqual(
    f.log.filter(([k]) => k === 'manager' || k === 'chrome'),
    [
      ['manager', { captureId: 'c1', cause: 'superseded' }],
      ['chrome', 'vault-capture-dropped', { captureId: 'c1' }]
    ]
  );
});

test('AC14: a NON-offered drop reaches the manager but sends NOTHING to the chrome (and never even resolves it)', () => {
  const f = fakes();
  routeCaptureDropped({ captureId: 'c1', wcId: 7, offered: false }, f.deps);
  assert.ok(f.log.some(([k]) => k === 'manager'));
  assert.equal(
    f.log.some(([k]) => k === 'chrome' || k === 'chromeForTab'),
    false
  );
});

test('AC14: the chrome is resolved per wcId at EVENT time via chromeForTab (class 3) - never a fan-out', () => {
  const f = fakes();
  routeCaptureDropped({ captureId: 'c1', wcId: 42, offered: true }, f.deps);
  assert.deepEqual(
    f.log.filter(([k]) => k === 'chromeForTab'),
    [['chromeForTab', 42]]
  );
});

test('AC14: a null owner record / manager / chrome (tab-close, move, window-close drops) returns quietly', () => {
  assert.doesNotThrow(() => {
    routeCaptureDropped({ captureId: 'c', wcId: 1, offered: true }, fakes({ manager: false, chrome: false }).deps);
    routeCaptureDropped({ captureId: 'c', wcId: 1, offered: true }, fakes({ manager: false }).deps);
    routeCaptureDropped({ captureId: 'c', wcId: 1, offered: true }, fakes({ chrome: false }).deps);
  });
  const f = fakes({ destroyed: true });
  routeCaptureDropped({ captureId: 'c', wcId: 1, offered: true }, f.deps);
  assert.equal(
    f.log.some(([k]) => k === 'chrome'),
    false,
    'a destroyed chrome (teardown) is tolerated'
  );
});
