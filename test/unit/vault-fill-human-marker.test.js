'use strict';

// Source pins for the human-vs-automation fill split (Mission 23 Flight 1, leg `vault-fill-trust`): main marks
// every HUMAN fill message `{ human: true }`; the guest then consumes the pending fill target and fills
// strictly (no first-form fallback) only for those, and an automation fill (unmarked) never consumes a
// human's target. The isolated-world bundle and the preload comments are checked too.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const main = read('src/main/main.js');
const preload = read('src/preload/webview-preload.js');

/** The text of the human vault-human deps block, and of the automation fill delegate. */
const humanBlock = main.slice(
  main.indexOf('_vaultHuman = createVaultHuman({'),
  main.indexOf('// M19 F1 Leg 2 (DD5/DD13): the browser-CSV-import flow')
);

test('main marks the three human fill messages { human: true } and the automation fill delegate is UNMARKED', () => {
  for (const [channel, arg] of [
    ['vault-fill', 'credential'],
    ['vault-fill-card', 'card'],
    ['vault-fill-identity', 'identity']
  ]) {
    assert.ok(
      humanBlock.includes(`?.send('${channel}', ${arg}, { human: true })`),
      `the human ${channel} message carries the marker`
    );
  }
  // The automation delegate sends the credential unmarked (its own deps block, a different site).
  const unmarked = [...main.matchAll(/\?\.send\('vault-fill', credential\);/g)];
  assert.equal(unmarked.length, 1, 'exactly one unmarked vault-fill send: the automation fill');
  assert.ok(main.indexOf(unmarked[0][0]) > main.indexOf('// M19 F1 Leg 2 (DD5/DD13)'), 'it is outside the human block');
});

test('the guest consumes the pending target and fills strictly ONLY for a marked fill; an unmarked fill never touches it', () => {
  for (const [channel, family, fn] of [
    ['vault-fill', 'login', 'fillLogin'],
    ['vault-fill-card', 'card', 'fillCard'],
    ['vault-fill-identity', 'identity', 'fillIdentity']
  ]) {
    const listener = preload.match(
      new RegExp(`ipcRenderer\\.on\\('${channel}', \\(_e, \\w+, meta\\) => \\{[\\s\\S]*?\\n\\}\\);`)
    );
    assert.ok(listener, `${channel} listener takes (payload, meta)`);
    const body = listener[0];
    assert.match(body, /const human = isHumanFill\(meta\);/);
    assert.ok(
      body.includes(`human ? vaultIcons.consumeFillTarget('${family}') : null`),
      `${channel}: only a human fill consumes the target`
    );
    assert.ok(
      new RegExp(`entryTracker\\.${fn}\\(\\{[^}]*strict: human`).test(body),
      `${channel}: strict only for a human fill`
    );
  }
  assert.match(preload, /const isHumanFill = \(meta\) => !!meta && meta\.human === true;/);
});

test('the isolated-world bootstrap passes requireOrdinal from `strict` to each field module, and nothing else turns it on', () => {
  const boot = read('src/preload/vault-entry-observer-bootstrap.js');
  for (const fn of ['fillLoginForm', 'fillCardForm', 'fillIdentityForm']) {
    assert.ok(boot.includes(`${fn}(document, `) && /requireOrdinal: arg\.strict === true/.test(boot), fn);
  }
  assert.equal((boot.match(/requireOrdinal: arg\.strict === true/g) || []).length, 3);
  for (const rel of [
    'src/preload/vault-fill-fields.js',
    'src/preload/vault-card-fields.js',
    'src/preload/vault-identity-fields.js'
  ]) {
    assert.match(read(rel), /options && options\.requireOrdinal === true/, rel);
  }
});

test('the preload comment no longer claims a page cannot listen for vault-fill* (leg 1 found it can obtain the IPC object)', () => {
  assert.ok(!/page JS cannot register a rogue 'vault-fill' listener/.test(preload));
  assert.match(preload, /a page-patched\s*\/\/ `Array\.prototype\.push` receives Electron's emit event/);
  const bundle = path.join(root, 'src/preload/webview-preload.bundle.js');
  if (fs.existsSync(bundle)) {
    const text = fs.readFileSync(bundle, 'utf8');
    assert.match(text, /strict: human/, 'the generated bundle was rebuilt with the new listeners');
    assert.ok(!/readTrusted/.test(text), 'the icon handlers no longer read isTrusted');
  }
});
