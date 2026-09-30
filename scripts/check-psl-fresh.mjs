// `preversion` guard (squawk 0117): refuse a release bump when the vendored Public
// Suffix List snapshot is older than PSL_RELEASE_MAX_AGE_DAYS. Offline by design.
import { createRequire } from 'node:module';
import { pslFreshness, PSL_RELEASE_MAX_AGE_DAYS } from './lib/psl-freshness.mjs';

const require = createRequire(import.meta.url);
const { SNAPSHOT_MS } = require('../src/main/psl.js');

const { stale, ageDays } = pslFreshness(SNAPSHOT_MS, Date.now());
if (stale) {
  const age = ageDays === null ? 'unreadable' : `${ageDays} days old`;
  console.error(
    `Refusing to bump the version: the vendored Public Suffix List snapshot is ${age} ` +
      `(limit ${PSL_RELEASE_MAX_AGE_DAYS} days).\n` +
      'Refresh it as its own reviewed change first: node scripts/update-psl.mjs\n' +
      '(see docs/RELEASING.md).'
  );
  process.exit(1);
}
console.log(`PSL snapshot is ${ageDays} days old (limit ${PSL_RELEASE_MAX_AGE_DAYS}) - ok.`);
