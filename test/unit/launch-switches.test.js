'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ls = require('../../src/main/launch-switches');

/** Fake command line: `present` maps name -> value. */
function cl(present, opts = {}) {
  return {
    isPackaged: opts.isPackaged !== false,
    hasSwitch: (n) => {
      if (opts.throwOn && opts.throwOn.includes(n)) throw new Error('boom');
      return Object.prototype.hasOwnProperty.call(present, n);
    },
    getSwitchValue: (n) => {
      if (opts.valueThrows) throw new Error('boom');
      return Object.prototype.hasOwnProperty.call(present, n) ? present[n] : '';
    }
  };
}

test('drift guard: no name in both tables; tables frozen, dash-free, unique', () => {
  const both = ls.STRIPPED.filter((n) => ls.REFUSED.includes(n));
  assert.deepEqual(both, []);
  assert.ok(!ls.STRIPPED.includes(ls.DISABLE_FEATURES_NAME) && !ls.REFUSED.includes(ls.DISABLE_FEATURES_NAME));
  for (const t of [ls.STRIPPED, ls.REFUSED]) {
    assert.ok(Object.isFrozen(t));
    assert.equal(new Set(t).size, t.length);
    for (const n of t) assert.match(n, /^[a-z][a-z-]*$/);
  }
});

test('allow-file-access-from-files is on neither list (Electron adds it to every launch itself)', () => {
  assert.ok(!ls.STRIPPED.includes('allow-file-access-from-files'));
  assert.ok(!ls.REFUSED.includes('allow-file-access-from-files'));
  assert.deepEqual(ls.decideLaunchSwitches(cl({ 'allow-file-access-from-files': '' })), { remove: [], refuse: [] });
});

test('unpackaged: both empty whatever is present', () => {
  const all = Object.fromEntries([...ls.STRIPPED, ...ls.REFUSED].map((n) => [n, '1']));
  all['disable-features'] = 'SitePerProcess';
  assert.deepEqual(ls.decideLaunchSwitches(cl(all, { isPackaged: false })), { remove: [], refuse: [] });
});

test('each stripped switch alone is removed, not refused; empty value counts', () => {
  for (const n of ls.STRIPPED) {
    assert.deepEqual(ls.decideLaunchSwitches(cl({ [n]: 'x' })), { remove: [n], refuse: [] }, n);
    assert.deepEqual(ls.decideLaunchSwitches(cl({ [n]: '' })), { remove: [n], refuse: [] }, n);
  }
});

test('each refused switch alone is refused, not removed; empty value counts', () => {
  for (const n of ls.REFUSED) {
    assert.deepEqual(ls.decideLaunchSwitches(cl({ [n]: 'x' })), { remove: [], refuse: [n] }, n);
    assert.deepEqual(ls.decideLaunchSwitches(cl({ [n]: '' })), { remove: [], refuse: [n] }, n);
  }
});

test('several together come back in table order, from the tables', () => {
  const d = ls.decideLaunchSwitches(
    cl({ 'log-net-log': 'a', 'host-rules': 'b', 'js-flags': 'c', 'remote-debugging-port': '1', 'load-extension': 'd' })
  );
  assert.deepEqual(d.remove, ['remote-debugging-port', 'host-rules', 'load-extension']);
  assert.deepEqual(d.refuse, ['js-flags', 'log-net-log']);
});

test('none present, and switches on neither list, are untouched', () => {
  assert.deepEqual(ls.decideLaunchSwitches(cl({})), { remove: [], refuse: [] });
  const d = ls.decideLaunchSwitches(
    cl({
      'no-sandbox': '',
      'disable-gpu-sandbox': '',
      'proxy-server': 'http://127.0.0.1:1',
      'enable-features': 'SitePerProcess',
      'user-data-dir': '/x'
    })
  );
  assert.deepEqual(d, { remove: [], refuse: [] });
});

test('disable-features: refused only when it names a site-isolation token', () => {
  const refused = (v) => ls.decideLaunchSwitches(cl({ 'disable-features': v })).refuse;
  assert.deepEqual(refused('IsolateOrigins'), ['disable-features']);
  assert.deepEqual(refused('site-per-process'), ['disable-features']);
  assert.deepEqual(refused('SitePerProcess'), ['disable-features']);
  assert.deepEqual(refused('Foo,IsolateOrigins,site-per-process,Bar'), ['disable-features']);
  assert.deepEqual(refused('Foo, SitePerProcess ,Bar'), ['disable-features']);
  assert.deepEqual(refused('Foo,\tIsolateOrigins\t'), ['disable-features']);
  assert.deepEqual(refused('SitePerProcess<Study'), ['disable-features']);
  assert.deepEqual(refused('SitePerProcess:k/v'), ['disable-features']);
  for (const ok of [
    '',
    'IsolateOriginsX',
    'isolateorigins',
    'SITEPERPROCESS',
    'XSitePerProcess',
    'site-per-process-x',
    'Other,Another',
    'ForceThirdPartyCookieBlockingEnabled'
  ]) {
    assert.deepEqual(refused(ok), [], ok);
  }
  assert.deepEqual(ls.decideLaunchSwitches(cl({ 'disable-features': 'SitePerProcess' })).remove, []);
});

test('a throwing hasSwitch refuses that name (fail closed), never throws out', () => {
  assert.deepEqual(ls.decideLaunchSwitches(cl({}, { throwOn: ['js-flags'] })), { remove: [], refuse: ['js-flags'] });
  assert.deepEqual(ls.decideLaunchSwitches(cl({}, { throwOn: ['host-rules'] })), {
    remove: [],
    refuse: ['host-rules']
  });
  assert.deepEqual(ls.decideLaunchSwitches(cl({}, { throwOn: ['disable-features'] })).refuse, ['disable-features']);
  // a throwing value read on a present disable-features is also a refusal
  assert.deepEqual(ls.decideLaunchSwitches(cl({ 'disable-features': 'Foo' }, { valueThrows: true })).refuse, [
    'disable-features'
  ]);
});

test('applyLaunchSwitches removes, re-asks, and promotes failures to refusals', () => {
  const present = new Set(['host-rules', 'remote-debugging-port', 'load-extension']);
  const removed = [];
  const final = ls.applyLaunchSwitches(
    { remove: ['remote-debugging-port', 'host-rules', 'load-extension'], refuse: ['js-flags'] },
    {
      removeSwitch: (n) => {
        removed.push(n);
        present.delete(n);
      },
      hasSwitch: (n) => present.has(n)
    }
  );
  assert.deepEqual(final, ['js-flags']);
  assert.deepEqual(removed, ['remote-debugging-port', 'host-rules', 'load-extension']);
});

test('applyLaunchSwitches: a throwing removal and a still-present switch are promoted', () => {
  const present = new Set(['a-throws', 'b-stays', 'c-goes']);
  const calls = [];
  const final = ls.applyLaunchSwitches(
    { remove: ['a-throws', 'b-stays', 'c-goes'], refuse: [] },
    {
      removeSwitch: (n) => {
        calls.push(n);
        if (n === 'a-throws') throw new Error('no');
        if (n === 'c-goes') present.delete(n);
      },
      hasSwitch: (n) => present.has(n)
    }
  );
  assert.deepEqual(final, ['a-throws', 'b-stays']);
  assert.deepEqual(calls, ['a-throws', 'b-stays', 'c-goes'], 'one failure never stops the rest');
  assert.deepEqual(ls.removedNames({ remove: ['a-throws', 'b-stays', 'c-goes'] }, final), ['c-goes']);
  // a re-ask that throws is a failure too
  const f2 = ls.applyLaunchSwitches(
    { remove: ['x'], refuse: [] },
    {
      removeSwitch: () => {},
      hasSwitch: () => {
        throw new Error('boom');
      }
    }
  );
  assert.deepEqual(f2, ['x']);
});

test('messages name only table switches and carry no value', () => {
  assert.equal(
    ls.removalLine(['host-rules', 'load-extension']),
    'goldfinch: ignored launch switches: --host-rules, --load-extension'
  );
  assert.equal(ls.refusalLine(['js-flags']), 'goldfinch: refusing to start: --js-flags (exit 64)');
  assert.match(ls.refusalBody(['js-flags', 'log-net-log']), /--js-flags, --log-net-log/);
  assert.equal(ls.REFUSAL_EXIT_CODE, 64);
});
