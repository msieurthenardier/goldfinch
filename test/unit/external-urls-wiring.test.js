'use strict';

// Sortie 01 (default browser) leg 1 AC6: renderer.js is a DOM-bound module, so the boot
// barrier wiring is proven by a source-scan pin (house style: comment-masked source,
// wrap-insensitive regexes, assertMutated, neuter-verified). It pins that:
//   (i)  `.finally(() => externalUrls.releaseBoot())` chains the WHOLE boot
//        `Promise.all([...]).then(...)` — not inside the `.then` body, which never runs
//        when Promise.all rejects (bookmarksClient.boot has no catch); and
//   (ii) the controller is constructed ABOVE `Promise.all(` so its listener is live
//        before main's queued sends flush on the windowBootConfig invoke.
// That the barrier really orders URL tabs after restored tabs is carried by this pin
// plus behavior-test rows 7-8 (default-browser-handoff) — no unit test claims it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer', 'renderer.js');
const masked = maskComments(fs.readFileSync(RENDERER, 'utf8'));

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

const PROMISE_ALL_RE = /Promise\.all\(\s*\[\s*window\.goldfinch\.settingsGet\('homePage'\)/;
const THEN_RE = /\)\s*\.then\(\s*\(\[\s*url,\s*engine,/;
const FINALLY_RE = /^\s*\.finally\(\s*\(\)\s*=>\s*externalUrls\.releaseBoot\(\)\s*\)\s*;/;
const CONSTRUCT_RE = /const externalUrls = createExternalUrlsController\(/;

/** @returns {string[]} violations */
function violations(src) {
  const out = [];
  const all = src.search(PROMISE_ALL_RE);
  const build = src.search(CONSTRUCT_RE);
  if (all === -1) return ['boot Promise.all([...]) anchor not found — re-anchor this pin'];
  if (build === -1) out.push('externalUrls controller construction not found');
  else if (build > all) out.push('controller must be constructed BEFORE the boot Promise.all(');
  const thenMatch = src.slice(all).match(THEN_RE);
  if (!thenMatch || thenMatch.index === undefined) return [...out, 'boot .then(([url, engine, …]) anchor not found'];
  const thenOpen = all + thenMatch.index + thenMatch[0].indexOf('.then(') + '.then'.length;
  const thenClose = findMatchingBracket(src, thenOpen, '(', ')');
  if (thenClose === -1) return [...out, 'boot .then( has no matching close'];
  if (!FINALLY_RE.test(src.slice(thenClose + 1))) {
    out.push('.finally(() => externalUrls.releaseBoot()) must chain the whole Promise.all(...).then(...)');
  }
  const thenBody = src.slice(thenOpen, thenClose);
  if (/externalUrls\.releaseBoot/.test(thenBody)) out.push('releaseBoot must not be called inside the .then body');
  return out;
}

test('real renderer.js wires the barrier correctly', () => {
  assert.deepEqual(violations(masked), []);
});

test('neuter: deleting the .finally turns the pin red', () => {
  const m = masked.replace(/\s*\.finally\(\s*\(\)\s*=>\s*externalUrls\.releaseBoot\(\)\s*\)/, '');
  assertMutated(masked, m, 'finally delete');
  assert.notDeepEqual(violations(m), []);
});

test('neuter: moving releaseBoot inside the .then turns the pin red', () => {
  let m = masked.replace(/\s*\.finally\(\s*\(\)\s*=>\s*externalUrls\.releaseBoot\(\)\s*\)/, '');
  assertMutated(masked, m, 'finally delete (move step 1)');
  const before = m;
  m = m.replace(/(\n(\s*)else createTab\(url\);)/, '$1\n$2externalUrls.releaseBoot();');
  assertMutated(before, m, 'releaseBoot insert inside .then (move step 2)');
  assert.notDeepEqual(violations(m), []);
});

test('neuter: constructing the controller after the boot chain turns the pin red', () => {
  const m = masked.replace(CONSTRUCT_RE, 'const externalUrlsLate = createExternalUrlsController(');
  assertMutated(masked, m, 'construction rename');
  const late = m + '\nconst externalUrls = createExternalUrlsController({});\n';
  assert.notDeepEqual(violations(late), []);
});
