'use strict';

// DD8 destroyed-window tripwire (M09 Flight 7, Leg 1) — a self-deriving source-scan
// test in the broadcast-invariant.test.js house pattern, asserting the project
// convention CLAUDE.md's destroyed-window rule states:
//
//   src/main/** contains ZERO raw `.on('closed'` / `.once('closed'` registrations
//   outside onWindowClosed's own definition.
//
// WHY THIS SHAPE (Tier 1 — registration-site exclusivity). A BaseWindow `closed`
// handler must never read through the window: property access on a destroyed
// BaseWindow THROWS, and an uncaught throw inside the native `closed` emission aborts
// the listener chain AND permanently wedges the Wayland close path with zero error
// output (the F6 leg-4 fix-cycle root cause). Two weaker forms were considered and
// retired at leg design:
//   - the POSITIVE form ("every `.on('closed')` callback reads only captured
//     primitives") needs SCOPE RESOLUTION, which marker-matching cannot express;
//   - the NEGATIVE form (scan callback bodies for `win.`) is defeated by the same
//     aliasing that defeats the ESLint rule (`const w = win`, `helper(win)`,
//     `rec.win`).
// Banning the REGISTRATION SHAPE cannot be evaded by aliasing, and it forces the
// onWindowClosed wrapper DD8 names "the primary net" rather than merely policing what
// a callback reads.
//
// SCOPE — `'closed'` ONLY, and deliberately not `'close'`. Electron's BaseWindow
// `'closed'` and Node's stream/server `'close'` differ by exactly one character;
// src/main/automation/mcp-server.js uses Node's `'close'` throughout and never
// `'closed'`. Widening this regex to `'close'` would manufacture false positives
// across the whole MCP server. Do not.
//
// The scan reuses the house toolkit verbatim (maskComments + findMatchingBracket) so a
// registration-shaped mention inside a COMMENT cannot trip it — this file's own
// wrapper doc comment mentions `.on('closed'` twice, exactly the footgun
// broadcast-invariant.test.js:278-285 guards against.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MAIN_DIR = path.join(__dirname, '../../src/main');

// The sanctioned wrapper: its own body is the ONE place a raw `closed` registration
// may live. Everything else must route through it.
const WRAPPER_NAME = 'onWindowClosed';
const WRAPPER_RE = /function\s+onWindowClosed\s*\([^)]*\)\s*\{/;

// Deliberate exceptions. EMPTY BY DESIGN: post-conversion src/main/** has exactly one
// `closed` registration (inside the wrapper), so the net passes with a zero-entry
// allowlist — pinned by the dedicated test below.
/** @type {Set<string>} */
const ALLOWLIST = new Set([]);

const VIOLATION_RE = /\.(?:on|once)\(\s*'closed'/g;

// --- house toolkit (broadcast-invariant.test.js:69-150) --------------------------

/**
 * Replace every // line comment and block-comment body with spaces (newlines
 * preserved), leaving string/template literal contents untouched. Output is the SAME
 * LENGTH as the input, so indices found against the masked copy are valid offsets into
 * the original.
 * @param {string} source
 * @returns {string}
 */
function maskComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] + source[i + 1];
          i += 2;
        } else {
          out += source[i];
          i++;
        }
      }
      if (i < n) {
        out += source[i];
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Index of the bracket matching `open` at `openIdx`, skipping string/template literal
 * contents. Operates on already comment-masked text.
 * @param {string} masked
 * @param {number} openIdx
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function findMatchingBracket(masked, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < masked.length && masked[i] !== quote) {
        if (masked[i] === '\\') i++;
        i++;
      }
    }
  }
  return -1;
}

// --- the scan -------------------------------------------------------------------

/** Every .js file under src/main/**, recursively. */
function collectSources(dir) {
  /** @type {string[]} */
  const out = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...collectSources(full));
    else if (dirent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Mask comments, then excise onWindowClosed's own function body (bracket-balanced) —
 * that one definition is the sanctioned registration. Returns the remaining text (with
 * the wrapper body blanked, length preserved) and whether the wrapper was found here.
 * @param {string} source
 * @returns {{ scanned: string, wrapperFound: boolean }}
 */
function exciseWrapper(source) {
  const masked = maskComments(source);
  const m = masked.match(WRAPPER_RE);
  if (!m || m.index === undefined) return { scanned: masked, wrapperFound: false };
  const openIdx = m.index + m[0].length - 1; // the matched trailing '{'
  const closeIdx = findMatchingBracket(masked, openIdx, '{', '}');
  assert.notEqual(closeIdx, -1, `unbalanced ${WRAPPER_NAME} body`);
  // Blank the body rather than splice it, so offsets stay valid for labelling.
  const body = masked.slice(m.index, closeIdx + 1);
  const blanked = body.replace(/[^\n]/g, ' ');
  return {
    scanned: masked.slice(0, m.index) + blanked + masked.slice(closeIdx + 1),
    wrapperFound: true
  };
}

/**
 * @param {string} source
 * @param {string} label
 * @returns {{ violations: string[], wrapperFound: boolean }}
 */
function scanSource(source, label) {
  const { scanned, wrapperFound } = exciseWrapper(source);
  /** @type {string[]} */
  const violations = [];
  let m;
  VIOLATION_RE.lastIndex = 0;
  while ((m = VIOLATION_RE.exec(scanned))) {
    const line = scanned.slice(0, m.index).split('\n').length;
    violations.push(`${label}:${line}`);
  }
  return { violations, wrapperFound };
}

// --- the net --------------------------------------------------------------------

test("src/main/** has ZERO raw `closed` registrations outside onWindowClosed's definition", () => {
  const files = collectSources(MAIN_DIR);
  // Sanity: fail loudly if the file walk itself breaks rather than scanning nothing.
  assert.ok(files.length > 5, `expected the src/main tree, found ${files.length} files`);

  /** @type {string[]} */
  let violations = [];
  let wrapperDefinitions = 0;
  for (const file of files) {
    const label = path.relative(path.join(__dirname, '../..'), file);
    const res = scanSource(fs.readFileSync(file, 'utf8'), label);
    if (res.wrapperFound) wrapperDefinitions++;
    violations.push(...res.violations);
  }

  // Vacuity guard (the broadcast-invariant.test.js:223-225 idiom, adapted). Here the
  // EXPECTED count is zero violations, so a vacuous pass (a broken excision, a renamed
  // wrapper, a file walk that found nothing) looks identical to a real one. Asserting
  // the wrapper's definition was found and excised is what makes this fail loudly
  // instead of passing for the wrong reason.
  assert.equal(
    wrapperDefinitions,
    1,
    `expected exactly ONE ${WRAPPER_NAME} definition in src/main/** (found ${wrapperDefinitions}) — ` +
      'a rename or refactor that breaks the excision must fail here, not pass vacuously'
  );

  violations = violations.filter((v) => !ALLOWLIST.has(v));
  assert.deepEqual(
    violations,
    [],
    `raw \`closed\` registration(s) outside ${WRAPPER_NAME}: ${violations.join(', ')}. ` +
      `Use ${WRAPPER_NAME}(win, handler) — it captures the window id at registration ` +
      'time, so the handler cannot reach through a destroyed window.'
  );
});

test('the allowlist is empty — the wrapper is the only sanctioned registration site', () => {
  assert.equal(ALLOWLIST.size, 0);
});

// ---------------------------------------------------------------------------
// Regression insurance for the scan's own logic (synthetic strings — never real
// source mutation; the leg's "add a violating registration and re-run" sanity check is
// a by-hand Verification Step, not a committed mutation test).
// ---------------------------------------------------------------------------

test('the scan FAILS a synthetic violating registration outside the wrapper', () => {
  const src = [
    'function onWindowClosed(win, handler) {',
    '  const winId = win.id;',
    "  win.on('closed', () => handler(winId));",
    '}',
    'function createWindow() {',
    "  win.on('closed', () => { registry.remove(win.id); });",
    '}'
  ].join('\n');
  const { violations, wrapperFound } = scanSource(src, 'fake.js');
  assert.equal(wrapperFound, true, "the wrapper's own definition was located");
  assert.deepEqual(violations, ['fake.js:6'], 'the registration OUTSIDE the wrapper is the only violation');
});

test('the scan PASSES source whose only registration is the wrapper itself', () => {
  const src = [
    'function onWindowClosed(win, handler) {',
    '  const winId = win.id;',
    "  win.on('closed', () => handler(winId));",
    '}',
    'function createWindow() {',
    '  onWindowClosed(win, (id) => registry.remove(id));',
    '}'
  ].join('\n');
  const { violations, wrapperFound } = scanSource(src, 'fake.js');
  assert.equal(wrapperFound, true);
  assert.deepEqual(violations, []);
});

test('.once(\'closed\') is caught too, not just .on', () => {
  const src = "function onWindowClosed(win, handler) { win.on('closed', () => handler(win.id)); }\nwin.once('closed', () => {});";
  const { violations } = scanSource(src, 'fake.js');
  assert.deepEqual(violations, ['fake.js:2']);
});

test("a registration-shaped mention inside a COMMENT is not a violation", () => {
  // This very test file's wrapper doc comment mentions `.on('closed'` — the mask is
  // what stops the net from tripping on prose about itself.
  const src = [
    'function onWindowClosed(win, handler) {',
    "  win.on('closed', () => handler(win.id));",
    '}',
    "// never write win.on('closed', ...) yourself — use the wrapper",
    "/* win.once('closed', cb) is banned too */",
    'const x = 1;'
  ].join('\n');
  const { violations } = scanSource(src, 'fake.js');
  assert.deepEqual(violations, [], 'comment mentions are masked out');
});

test("Node's 'close' is NOT flagged — it differs from Electron's 'closed' by one character", () => {
  // mcp-server.js uses Node's 'close' throughout. Widening the regex would light the
  // whole file up with false positives.
  const src = [
    'function onWindowClosed(win, handler) {',
    "  win.on('closed', () => handler(win.id));",
    '}',
    "server.on('close', () => {});",
    "socket.once('close', () => {});"
  ].join('\n');
  const { violations } = scanSource(src, 'fake.js');
  assert.deepEqual(violations, []);
});

test('a file with no wrapper still gets scanned for violations', () => {
  // wrapperFound is per-file; the aggregate assertion is what pins "exactly one
  // definition across the tree", so a violating file without the wrapper must still
  // report.
  const src = "win.on('closed', () => { console.log(win.id); });";
  const { violations, wrapperFound } = scanSource(src, 'other.js');
  assert.equal(wrapperFound, false);
  assert.deepEqual(violations, ['other.js:1']);
});
