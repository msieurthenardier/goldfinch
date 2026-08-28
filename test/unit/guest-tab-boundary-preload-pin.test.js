'use strict';

// Source-pin (M17 Flight 1 Leg 1, AC1/AC8): both guest preloads —
// webview-preload.js (web branch, contextIsolation:false) and
// internal-preload.js (trusted branch, contextIsolation:true + sandbox:true)
// — register the SAME tab-boundary capturing keydown listener, via CAPTURED
// natives (addEventListener, Event.prototype.preventDefault), and require
// the shared src/shared/tab-boundary module. This is a grep-AC style pin
// (CLAUDE.md's "Grep-AC convention") over the two source files, not a
// behavior test — the behavior itself is exercised live via the behavior
// spec and via tab-boundary.test.js's pure logic.
//
// Neuter-verified: each assertion below was checked to go RED when its
// guarded line is removed/altered, then restored (see the flight log's
// neuter table).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const webSrc = fs.readFileSync(path.join(repoRoot, 'src', 'preload', 'webview-preload.js'), 'utf8');
const internalSrc = fs.readFileSync(path.join(repoRoot, 'src', 'preload', 'internal-preload.js'), 'utf8');

for (const [label, src] of [
  ['webview-preload.js', webSrc],
  ['internal-preload.js', internalSrc]
]) {
  test(`${label}: requires the shared tab-boundary module`, () => {
    assert.match(src, /require\(['"]\.\.\/shared\/tab-boundary['"]\)/);
  });

  test(`${label}: registers a CAPTURING keydown listener (trailing \`true\`)`, () => {
    assert.match(src, /nativeAddEventListener\(\s*\n?\s*'keydown',[\s\S]{0,600}?,\s*\n?\s*true\s*\n?\s*\)/);
  });

  test(`${label}: captures addEventListener as a native reference before use`, () => {
    assert.match(src, /const nativeAddEventListener = window\.addEventListener\.bind\(window\);/);
  });

  test(`${label}: captures Event.prototype.preventDefault as a native reference before use`, () => {
    assert.match(src, /const nativePreventDefault = Event\.prototype\.preventDefault;/);
  });

  test(`${label}: calls the CAPTURED preventDefault at the boundary, not event.preventDefault()`, () => {
    assert.match(src, /nativePreventDefault\.call\(event\)/);
  });

  test(`${label}: sends the payload-minimal guest-tab-boundary IPC with only a direction`, () => {
    assert.match(src, /ipcRenderer\.send\('guest-tab-boundary',\s*\{\s*direction\s*\}\)/);
  });

  test(`${label}: ignores auto-repeat presses`, () => {
    assert.match(src, /event\.repeat/);
  });

  test(`${label}: ignores modified Tab (ctrl/meta/alt)`, () => {
    assert.match(src, /event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey/);
  });
}
