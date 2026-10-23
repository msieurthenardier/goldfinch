'use strict';

// Sortie 05 (AC9): drift guard across every list that enumerates the internal hosts.
// INTERNAL_HOSTS (url-safety) === internal-page-map keys === hosts of main INTERNAL_ORIGINS
// === hosts of preload INTERNAL_ORIGINS === chrome INTERNAL_JAR_NAMES keys. A host missing
// from the origin sets fails CLOSED but silently (the page's bridge calls reject), so the
// agreement is pinned here. Source-scan flavor: every extraction THROWS when its anchor is
// not found (never vacuous); comparison is an order-insensitive set equality.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInternalPageMap } = require('../../src/main/internal-page-map');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractHostsFromSetLiteral(source, anchorRe, label, hostOf) {
  const m = anchorRe.exec(source);
  if (!m) throw new Error(`drift guard: could not find the ${label} Set literal`);
  const entries = [...m[1].matchAll(/'([^']+)'/g)].map((x) => hostOf(x[1]));
  if (entries.length === 0) throw new Error(`drift guard: ${label} parsed to zero entries`);
  return entries;
}

const originHost = (o) => {
  const m = /^goldfinch:\/\/([a-z]+)$/.exec(o);
  if (!m) throw new Error('drift guard: unexpected origin shape ' + o);
  return m[1];
};

function allLists() {
  const hosts = extractHostsFromSetLiteral(
    read('src/shared/url-safety.js'),
    /const INTERNAL_HOSTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    'INTERNAL_HOSTS',
    (x) => x
  );
  const mapKeys = Object.keys(
    createInternalPageMap({ baseDir: '/app/src/main', path: { join: (...p) => p.join('/') } })
  );
  const mainOrigins = extractHostsFromSetLiteral(
    read('src/main/internal-ipc.js'),
    /const INTERNAL_ORIGINS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    'main INTERNAL_ORIGINS',
    originHost
  );
  const preloadOrigins = extractHostsFromSetLiteral(
    read('src/preload/internal-preload.js'),
    /const INTERNAL_ORIGINS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    'preload INTERNAL_ORIGINS',
    originHost
  );
  const jarNamesSrc = /const INTERNAL_JAR_NAMES\s*=\s*\{([\s\S]*?)\}/.exec(
    read('src/renderer/chrome/tab-controller.js')
  );
  if (!jarNamesSrc) throw new Error('drift guard: could not find INTERNAL_JAR_NAMES');
  const jarNames = [...jarNamesSrc[1].matchAll(/^\s*([a-z]+):\s*'/gm)].map((x) => x[1]);
  if (jarNames.length === 0) throw new Error('drift guard: INTERNAL_JAR_NAMES parsed to zero entries');
  return { hosts, mapKeys, mainOrigins, preloadOrigins, jarNames };
}

const sorted = (xs) => [...new Set(xs)].sort();

function assertAgree(lists) {
  const base = sorted(lists.hosts);
  for (const [name, list] of Object.entries(lists)) {
    assert.deepEqual(sorted(list), base, `${name} disagrees with INTERNAL_HOSTS`);
  }
}

test('INTERNAL_HOSTS, page-map keys, both INTERNAL_ORIGINS sets and INTERNAL_JAR_NAMES agree', () => {
  const lists = allLists();
  assert.ok(lists.hosts.includes('automation'), 'sanity: the automation host is on the list');
  assertAgree(lists);
});

test('neuter: removing a host from any one list is detected', () => {
  for (const key of ['hosts', 'mapKeys', 'mainOrigins', 'preloadOrigins', 'jarNames']) {
    const lists = allLists();
    lists[key] = lists[key].filter((h) => h !== 'automation');
    assert.throws(() => assertAgree(lists), /disagrees/, key);
  }
});
