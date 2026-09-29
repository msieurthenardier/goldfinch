'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const nshRaw = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
const nsh = nshRaw
  .split(/\r?\n/)
  .filter((l) => !/^\s*;/.test(l))
  .join('\n');

test('Linux packaging config: desktopName, protocols, syncDesktopName, appId stable', () => {
  assert.equal(pkg.desktopName, 'goldfinch.desktop');
  assert.deepEqual(pkg.build.protocols, [{ name: 'Web', schemes: ['http', 'https'] }]);
  assert.equal(pkg.build.linux.syncDesktopName, true);
  assert.equal(pkg.build.appId, 'com.goldfinch.browser');
});

test('nsis include is wired and both macros exist', () => {
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
  assert.match(nsh, /!macro customInstall\b/);
  assert.match(nsh, /!macro customUnInstall\b/);
});

test('installer.nsh writes every registration key under SHELL_CONTEXT', () => {
  const keys = [
    'Software\\Classes\\GoldfinchHTML',
    'Software\\Classes\\GoldfinchHTML\\DefaultIcon',
    'Software\\Classes\\GoldfinchHTML\\shell\\open\\command',
    'Software\\Clients\\StartMenuInternet\\Goldfinch',
    'Software\\Clients\\StartMenuInternet\\Goldfinch\\DefaultIcon',
    'Software\\Clients\\StartMenuInternet\\Goldfinch\\shell\\open\\command',
    'Software\\Clients\\StartMenuInternet\\Goldfinch\\Capabilities',
    'Software\\Clients\\StartMenuInternet\\Goldfinch\\Capabilities\\StartMenu',
    'Software\\Clients\\StartMenuInternet\\Goldfinch\\Capabilities\\URLAssociations',
    'Software\\RegisteredApplications'
  ];
  for (const k of keys) assert.ok(nsh.includes(`SHELL_CONTEXT "${k}"`), `missing ${k}`);
  for (const v of [
    'ApplicationName',
    'ApplicationDescription',
    'ApplicationIcon',
    'FriendlyTypeName',
    'StartMenuInternet'
  ]) {
    assert.ok(nsh.includes(`"${v}"`), `missing value ${v}`);
  }
  assert.match(nsh, /URLAssociations" "http" "GoldfinchHTML"/);
  assert.match(nsh, /URLAssociations" "https" "GoldfinchHTML"/);
  assert.match(
    nsh,
    /"Software\\RegisteredApplications" "Goldfinch" "Software\\Clients\\StartMenuInternet\\Goldfinch\\Capabilities"/
  );
  assert.doesNotMatch(nsh, /URL Protocol/, 'ProgID must not set URL Protocol');
  assert.doesNotMatch(nsh, /\bHK(LM|CU)\b/, 'no hard-coded hive');
  assert.doesNotMatch(nsh, /CreateShortCut|AppUserModel/i);
});

test('APP_EXECUTABLE_FILENAME is the only exe reference and is defined by the installed template', () => {
  const exeRefs = nsh.match(/\.exe/gi) || [];
  assert.equal(exeRefs.length, 0, 'no literal .exe in the include');
  assert.ok(nsh.includes('${APP_EXECUTABLE_FILENAME}'));
  const common = fs.readFileSync(
    path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'common.nsh'),
    'utf8'
  );
  assert.match(common, /!define APP_EXECUTABLE_FILENAME\b/);
});

test('every delete is structurally inside the ${ifNot} ${isUpdated} block', () => {
  const lines = nsh.split('\n');
  let inUn = false;
  let guarded = false;
  let deletes = 0;
  for (const line of lines) {
    if (/!macro customUnInstall\b/.test(line)) inUn = true;
    else if (/!macroend/.test(line)) inUn = false;
    if (/\$\{ifNot\} \$\{isUpdated\}/.test(line)) guarded = true;
    else if (guarded && /\$\{endIf\}/.test(line)) guarded = false;
    if (/\b(DeleteRegKey|DeleteRegValue)\b/.test(line)) {
      deletes++;
      assert.ok(inUn && guarded, `unguarded delete: ${line.trim()}`);
    }
  }
  assert.equal(deletes, 3);
});

test('ms-settings registeredAppUser equals the RegisteredApplications value name (drift guard)', () => {
  const { WIN_DEFAULT_APPS_URL } = require('../../src/main/default-browser');
  const user = new URL(WIN_DEFAULT_APPS_URL).searchParams.get('registeredAppUser');
  assert.ok(user);
  assert.ok(nsh.includes(`"Software\\RegisteredApplications" "${user}" `));
});
