// Refresh the vendored Public Suffix List (squawk 0117). Usage: node scripts/update-psl.mjs
// Fetches ONLY the canonical URL below (no override), validates the body, overwrites
// src/main/public_suffix_list.dat and the `Snapshot:` line in src/main/psl.js. Never
// commits. On any failure nothing is written and the exit code is non-zero.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePslBody } from './lib/psl-freshness.mjs';

const PSL_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const DAT = fileURLToPath(new URL('../src/main/public_suffix_list.dat', import.meta.url));
const PSL_JS = fileURLToPath(new URL('../src/main/psl.js', import.meta.url));

function fail(msg) {
  console.error(`update-psl: ${msg}; no files were changed.`);
  process.exit(1);
}

const oldVersion = /^\/\/\s*VERSION:\s*(\S+)/m.exec(readFileSync(DAT, 'utf8'))?.[1] ?? '(unknown)';
const jsSrc = readFileSync(PSL_JS, 'utf8');
const snapshotRe = /^(\/\/ {3}Snapshot: )\S+( \(file header VERSION )\S+(\))/m;
if (!snapshotRe.test(jsSrc)) fail('could not find the Snapshot line in src/main/psl.js');

let body;
try {
  const res = await fetch(PSL_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) fail(`fetch failed: HTTP ${res.status}`);
  body = await res.text();
} catch (err) {
  fail(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
}

const newVersion = validatePslBody(body);
if (!newVersion) fail('fetched body failed validation (VERSION header / ICANN / PRIVATE markers)');

writeFileSync(DAT, body);
writeFileSync(PSL_JS, jsSrc.replace(snapshotRe, `$1${newVersion.slice(0, 10)}$2${newVersion}$3`));

console.log(`PSL VERSION: ${oldVersion} -> ${newVersion}`);
console.log(`
Post-refresh checklist (this script never commits):
  1. Re-check SUPPLEMENT_SUFFIX in src/main/trackers.js (amazonaws.com, netlify.com,
     surge.sh, glitch.me) against the new .dat and update its comment date.
  2. npm test  (psl.test.js runs against the vendored .dat)
  3. Review the curated TRACKERS table in src/main/trackers.js.
  4. Commit the refresh as its own reviewed change, before cutting the release.`);
