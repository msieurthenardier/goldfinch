'use strict';

// Automation-boundary pins for the browser-CSV-import ingest pipeline (M19
// F1 Leg 1, CP4's Leg 1 half — leg ruling 9). What this leg actually proves:
// NO automation tier — jar, admin, dev — can even NAME an import operation
// (a), the entire automation module tree contains zero references to the
// import machinery (b), and the held-payload store's `payload` field is
// read back only where the leg's design says it may be (c). The Leg 2 half
// (the IPC-layer refusal, the DD13 native confirm gate) is out of scope here
// — see the flight's CP4 for the full boundary.
//
// Grep-AC style (CLAUDE.md's "Grep-AC convention" / the
// vault-restore-workflow-invariants.test.js precedent): source-scan, no
// boot, no DOM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildToolRegistry } = require('../../src/main/automation/mcp-tools');

const REPO_ROOT = path.join(__dirname, '../..');
const AUTOMATION_DIR = path.join(REPO_ROOT, 'src/main/automation');
const PENDING_BROWSER_IMPORTS_SRC = fs.readFileSync(
  path.join(REPO_ROOT, 'src/main/vault/pending-browser-imports.js'),
  'utf8'
);

// ---------------------------------------------------------------------------
// (a) No tier can even NAME an import operation — no matching MCP tool
// exists, and the tool count this leg must NOT touch (EXPECTED_TOOL_COUNT =
// 35, automation-mcp-server.test.js:39) is untouched.
// ---------------------------------------------------------------------------

test('AC21(a): registry.listTools() contains no tool name matching /import|csv|chrome|browser/i', () => {
  // listTools() is a static discovery projection — it needs neither a real
  // engine nor a real vault ctx to enumerate names.
  const registry = buildToolRegistry(
    () => null,
    () => null
  );
  const names = registry.listTools().map((t) => t.name);
  assert.ok(names.length > 0, 'sanity: tools actually exist');
  // `getChromeTarget` is a pre-existing, unrelated admin chrome-target tool
  // (matches /chrome/i on its name alone) — excluded by name, not by
  // loosening the pattern, so a FUTURE tool actually named e.g.
  // `chromeImport` still trips this check.
  const suspects = names.filter((n) => n !== 'getChromeTarget' && /import|csv|chrome|browser/i.test(n));
  assert.deepEqual(suspects, [], 'no tool name references the import machinery, at any tier');
});

test('AC21(a): this leg touches no tool count — 35 tools total (EXPECTED_TOOL_COUNT, automation-mcp-server.test.js:39)', () => {
  const registry = buildToolRegistry(
    () => null,
    () => null
  );
  assert.equal(registry.listTools().length, 35);
});

// ---------------------------------------------------------------------------
// (b) Zero references anywhere under src/main/automation/** to the import
// machinery — the whole automation module tree cannot even IMPORT the code
// that would let it initiate a CSV import.
// ---------------------------------------------------------------------------

test('AC21(b): src/main/automation/** contains zero references to importLogins, pending-browser-imports, browser-import, or csv-parse', () => {
  const files = fs.readdirSync(AUTOMATION_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'sanity: the automation directory has files');
  const forbidden = /importLogins|pending-browser-imports|browser-import|csv-parse/;
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(AUTOMATION_DIR, f), 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (forbidden.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'no reference to the browser-import machinery anywhere under src/main/automation/**');
});

// M19 F1 Leg 2 (ruling 9(d)): the grep-AC above EXTENDS to Leg 2's flow module and its four
// IPC channel names — every one of them CONTAINS the substring "browser-import" (the
// filename "browser-import-flow" and each "internal-vault-browser-import-<verb>" channel),
// so the existing `forbidden` regex above already structurally catches them. Pinned
// explicitly here (rather than left implicit) so a future narrowing of that regex can't
// silently stop covering the Leg 2 surface.
test('AC15(d): the forbidden-reference regex above literally matches browser-import-flow and all four browser-import channel names', () => {
  const forbidden = /importLogins|pending-browser-imports|browser-import|csv-parse/;
  for (const name of [
    'browser-import-flow',
    'internal-vault-browser-import-pick',
    'internal-vault-browser-import-summary',
    'internal-vault-browser-import-cancel',
    'internal-vault-browser-import-commit'
  ]) {
    assert.ok(forbidden.test(name), `"${name}" matches the forbidden pattern`);
  }
});

// ---------------------------------------------------------------------------
// (c) The held-payload store's `payload` field is read back ONLY inside
// `take` and `drop` — never in `peekSummary` — and `peekSummary`'s return
// carries no `payload` key and no candidate field content.
// ---------------------------------------------------------------------------

/**
 * Extract one top-level factory-scoped function's body text (from
 * `function <name>(` up to the next `\n  function ` at the same 2-space
 * indent, or end of file) — the bounded non-greedy scan idiom (CLAUDE.md's
 * regex-target-mutation-pin convention) so a match can never cross into the
 * NEXT function.
 * @param {string} src
 * @param {string} name
 * @returns {string}
 */
function extractFunctionBody(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `function ${name} not found in pending-browser-imports.js`);
  const rest = src.slice(start);
  const nextFnOffset = rest.slice(marker.length).search(/\n {2}function \w+\(/);
  return nextFnOffset === -1 ? rest : rest.slice(0, marker.length + nextFnOffset);
}

test('AC21(c): pending-browser-imports.js reads `.payload` back ONLY inside take and drop — never inside peekSummary', () => {
  const takeBody = extractFunctionBody(PENDING_BROWSER_IMPORTS_SRC, 'take');
  const dropBody = extractFunctionBody(PENDING_BROWSER_IMPORTS_SRC, 'drop');
  const peekSummaryBody = extractFunctionBody(PENDING_BROWSER_IMPORTS_SRC, 'peekSummary');
  const holdBody = extractFunctionBody(PENDING_BROWSER_IMPORTS_SRC, 'hold');
  const clearBody = extractFunctionBody(PENDING_BROWSER_IMPORTS_SRC, 'clear');

  assert.ok(!/\.payload\b/.test(peekSummaryBody), 'peekSummary must never dereference .payload');
  assert.ok(!/\.payload\b/.test(clearBody), 'clear never dereferences .payload (it delegates to drop)');
  // hold DESTRUCTURES { payload } from its argument (to validate it) but must
  // never dot-reference an existing RECORD's .payload.
  assert.ok(!/rec\.payload\b/.test(holdBody), "hold never reads an existing record's .payload");
  assert.ok(/\.payload\b/.test(dropBody), 'sanity: drop is where the payload is actually zeroized');

  // Every `.payload` occurrence in the WHOLE file lives inside take's or
  // drop's extracted body text (allowing for the JSDoc/type-only mentions of
  // the bare word `payload`, which this regex — requiring a leading dot —
  // does not match).
  const allDotPayloadOffsets = [];
  const re = /\.payload\b/g;
  let m;
  while ((m = re.exec(PENDING_BROWSER_IMPORTS_SRC))) allDotPayloadOffsets.push(m.index);
  assert.ok(allDotPayloadOffsets.length > 0, 'sanity: the pattern actually matches something');

  const takeStart = PENDING_BROWSER_IMPORTS_SRC.indexOf(takeBody);
  const dropStart = PENDING_BROWSER_IMPORTS_SRC.indexOf(dropBody);
  for (const offset of allDotPayloadOffsets) {
    const inTake = offset >= takeStart && offset < takeStart + takeBody.length;
    const inDrop = offset >= dropStart && offset < dropStart + dropBody.length;
    assert.ok(inTake || inDrop, `a .payload reference at offset ${offset} falls outside take/drop`);
  }
});

test("AC21(c): peekSummary's returned object carries no payload key and no candidate field content", () => {
  const { createPendingBrowserImportStore } = require('../../src/main/vault/pending-browser-imports');
  let n = 0;
  // Fake timer fns — a real setTimeout here would arm a genuine 5-minute
  // HOLD_DROP_MS timer that outlives the test and hangs the file (an
  // unref'd/fake handle is the correct hygiene, not a real one to clean up).
  const store = createPendingBrowserImportStore({
    mintHandle: () => `h${++n}`,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  const SECRET_PASSWORD = 'boundary-secret-password-value';
  const payload = Buffer.from(SECRET_PASSWORD, 'utf8');
  store.hold(100, {
    payload,
    summary: { candidateCount: 2, skipped: [{ line: 4, reason: 'no-password' }] }
  });

  const projection = store.peekSummary(100);
  assert.equal('payload' in projection, false, 'no payload key on the returned projection');
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes(SECRET_PASSWORD), false, 'no candidate secret content leaks through peekSummary');
});
