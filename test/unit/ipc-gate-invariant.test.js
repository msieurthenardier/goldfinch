'use strict';

// Standing guard for the IPC gate (Mission 23 Flight 1, leg `ipc-gate`, DD2; closed at ZERO
// exceptions by leg `ipc-gate-complete`): every main-process IPC registration names a caller
// class. A self-deriving source scan over `src/main/**` (the broadcast-invariant /
// window-closed-invariant house pattern, built on the shared toolkit so a registration-shaped
// mention in a COMMENT cannot trip or satisfy it).
//
// It fails when:
//   1. a raw `ipcMain.handle(` / `ipcMain.on(` registers ANY channel (the exception list is
//      explicit, empty and pinned at size 0 — `LEGACY` is gone);
//   2. a registration's channel argument is not a string literal;
//   3. the token `ipcMain` appears anywhere but an enumerated context:
//        (a) the first argument of `registerInternalHandler(` / `registerInternal(`,
//        (b) a destructured PARAMETER (or `const { ipcMain } = deps`) of a function in a file that
//            registers internal channels through `registerInternalHandler` or hands `ipcMain` on
//            to an allowlisted registrar (a registrar that registers nothing raw takes no
//            `ipcMain` parameter at all),
//        (c) shorthand inside the object argument of a callee on the named registrar allowlist,
//        (d) the `require('electron')` destructure and the gate constructor call in `main.js`.
//      Assignment from it, spreading it and placing it in an array are banned outright.
//   4. the channels the scan finds (gate + internal registrations together) and the
//      classification table's keys are not the SAME set, in both directions;
//   5. a gate registration's class differs from its table entry; a sheet registration does not
//      take its menu types from the one table row; a tab-guest registration's switches differ
//      from the pinned per-channel table; the class totals drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket, collectSources } = require('../helpers/source-scan');
const ChannelTable = require('../../src/main/ipc-channel-table');
const { CHANNEL_CLASS, SHEET_MENU_TYPES } = ChannelTable;

const ROOT = path.join(__dirname, '../..');
const MAIN_DIR = path.join(ROOT, 'src/main');

// The gate module is the sanctioned wrapper over `ipcMain`: its body is exempt as a whole.
const GATE_FILE = 'ipc-gate.js';

// The explicit exception list: raw `ipcMain` registrations that are allowed. Empty, pinned at 0.
/** @type {readonly string[]} */
const RAW_EXCEPTIONS = Object.freeze([]);
const EXPECTED_RAW_EXCEPTIONS = 0;
const EXPECTED_CHANNELS = 206;

const GATE_CLASS = {
  chrome: 'chrome',
  owningChrome: 'owning-chrome',
  chromeOrInternal: 'chrome-or-internal',
  tabGuest: 'tab-guest',
  sheet: 'sheet',
  find: 'find',
  savePrompt: 'save-prompt',
  findOrOwningChrome: 'find-or-owning-chrome'
};

// Class totals over the whole table (this leg's 91 + the 40 before + the 74 internal).
const EXPECTED_CLASS_COUNTS = {
  chrome: 61,
  'owning-chrome': 30,
  'chrome-or-internal': 1,
  internal: 74,
  'tab-guest': 13,
  sheet: 19,
  find: 1,
  'save-prompt': 6,
  'find-or-owning-chrome': 1
};

// The 91 channels that were registered raw before this leg (the former `LEGACY` set), by their
// final class: 25 chrome + 26 owning-chrome + 19 sheet + 1 find + 1 find-or-owning-chrome +
// 6 save-prompt + 13 tab-guest.
const FORMER_LEGACY = [
  'window-boot-config',
  'automation:dev-invoke',
  'vault-fill-generated',
  'shields-farble',
  'window-minimize',
  'window-toggle-maximize',
  'window-close',
  'window-is-maximized',
  'window-create',
  'new-container-create',
  'vault-eligible',
  'guest-vault-gesture',
  'guest-tab-boundary',
  'guest-vault-icon-menu',
  'guest-vault-capture',
  'guest-vault-capture-card',
  'guest-vault-capture-identity',
  'guest-vault-gesture-settle',
  'vault-capture-finalize',
  'guest-media-list',
  'guest-privacy-fp',
  'guest-window-close',
  'rescan-media',
  'zoom-apply',
  'get-zoom',
  'print',
  'toggle-devtools',
  'is-devtools-open',
  'page-context-correct',
  'page-context-action',
  'identity-new',
  'privacy-cookies',
  'privacy-clear-cookies',
  'privacy-clear-storage',
  'downloads-snapshot',
  'menu-overlay:open',
  'menu-overlay:close',
  'menu-overlay:activated',
  'menu-overlay:dismissed',
  'menu-overlay:refocus',
  'menu-overlay:vault-unlock',
  'menu-overlay:vault-setup',
  'menu-overlay:vault-stepup-mint',
  'menu-overlay:vault-import',
  'menu-overlay:vault-rotate-recovery',
  'menu-overlay:vault-rotate-admin',
  'menu-overlay:vault-change-master',
  'menu-overlay:vault-recover',
  'menu-overlay:vault-compromise',
  'menu-overlay:vault-compromise-recover',
  'menu-overlay:copy-text',
  'menu-overlay:auth-submit',
  'menu-overlay:bookmark-edit-submit',
  'menu-overlay:overflow-drop',
  'menu-overlay:cert-override-proceed',
  'menu-overlay:sheet-drag',
  'find-overlay:open',
  'find-overlay:close',
  'find-overlay:query',
  'tearoff-overlay:show',
  'tearoff-overlay:move',
  'tearoff-overlay:hide',
  'save-prompt:open',
  'save-prompt:anchor',
  'save-prompt:pointer',
  'save-prompt:focus',
  'save-prompt:height',
  'save-prompt:dismiss',
  'save-prompt:save',
  'save-prompt:consent',
  'shields-restart-to-apply',
  'tab-create',
  'tab-close',
  'tab-history-snapshot',
  'tab-certificate-get',
  'move-targets',
  'tab-move-to-new-window',
  'tab-move-to-window',
  'tab-tear-off',
  'tab-drag-started',
  'tab-drag-ended',
  'bookmark-drag-started',
  'bookmark-drag-ended',
  'guest-bookmark-drop',
  'tab-adopt-by-drop',
  'tab-hide',
  'tab-navigate',
  'tab-focus-guest',
  'tab-set-active',
  'tab-set-bounds',
  'tab-find'
];

// The tab-guest switches, per channel (the leg's table; "no others"). Absent = all off.
/** @type {Record<string, string>} */
const TAB_GUEST_SWITCHES = {
  'shields-farble': 'popups',
  'vault-eligible': 'popups',
  'guest-window-close': 'popups',
  'guest-tab-boundary': 'activeOnly,internalTabs',
  // Mission 23 Flight 1 (leg `vault-fill-trust`): only an ACTIVE web tab can raise the picker.
  'guest-vault-gesture': 'activeOnly',
  'guest-vault-icon-menu': 'activeOnly'
};

// (d) named allowlist of callees whose object argument may carry shorthand `ipcMain`.
const REGISTRAR_CALLEES = new Set([
  'registerJarIpc',
  'registerJarRegistryIpc',
  'registerJarDataIpc',
  'registerHistoryIpc',
  'registerBookmarksIpc',
  'registerSettingsIpc',
  'registerDownloadIpc',
  'registerTabIpc',
  'registerBrowserIpc',
  'registerOverlayIpc',
  'registerSavePromptIpc',
  'registerVaultIpc',
  'registerAppLifecycle',
  'createIpcGate'
]);

/**
 * Blank (length-preserving) the body of a named function so a sanctioned wrapper is not
 * scanned.
 * @param {string} masked
 * @param {RegExp} headRe
 */
function blankFunction(masked, headRe) {
  const m = masked.match(headRe);
  if (!m || m.index === undefined) return masked;
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = findMatchingBracket(masked, openIdx, '{', '}');
  assert.notEqual(closeIdx, -1, 'unbalanced sanctioned wrapper body');
  return (
    masked.slice(0, m.index) + masked.slice(m.index, closeIdx + 1).replace(/[^\n]/g, ' ') + masked.slice(closeIdx + 1)
  );
}

/**
 * One forward pass recording, for every bare `ipcMain` identifier, the innermost unmatched
 * opening bracket at that point. Strings/templates are skipped (comments are already masked).
 * @param {string} masked
 * @returns {Array<{ index: number, top: { ch: string, index: number } | null }>}
 */
function ipcMainOccurrences(masked) {
  /** @type {Array<{ ch: string, index: number }>} */
  const stack = [];
  /** @type {Array<{ index: number, top: { ch: string, index: number } | null }>} */
  const found = [];
  const n = masked.length;
  for (let i = 0; i < n; i++) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < n && masked[i] !== ch) {
        if (masked[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') stack.push({ ch, index: i });
    else if (ch === ')' || ch === '}' || ch === ']') stack.pop();
    else if (ch === 'i' && masked.startsWith('ipcMain', i)) {
      const before = i > 0 ? masked[i - 1] : ' ';
      const after = masked[i + 7] || ' ';
      if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) {
        found.push({ index: i, top: stack.length ? stack[stack.length - 1] : null });
        i += 6;
      }
    }
  }
  return found;
}

/**
 * Scan one source file.
 * @param {string} source
 * @param {{ label: string, exceptions: readonly string[] }} ctx
 * @returns {{ registrations: Array<{ channel: string, form: 'raw' | 'internal' | 'gate', cls?: string, label: string }>, violations: string[] }}
 */
function scanSource(source, { label, exceptions }) {
  /** @type {Array<{ channel: string, form: 'raw' | 'internal' | 'gate', cls?: string, label: string, method?: string, extras?: string }>} */
  const registrations = [];
  /** @type {string[]} */
  const violations = [];
  const base = path.basename(label);
  if (base === GATE_FILE) return { registrations, violations };

  let masked = maskComments(source);
  masked = blankFunction(masked, /function\s+registerInternalHandler\s*\([^)]*\)\s*\{/);
  const lineOf = (/** @type {number} */ idx) => masked.slice(0, idx).split('\n').length;
  const at = (/** @type {number} */ idx) => `${label}:${lineOf(idx)}`;

  // (z) a webContents' OWN IPC emitter (`wc.ipc.on(` / `.handle(` / `.once(` ...) is a registration surface the
  // `ipcMain` scan cannot see. None is permitted in src/main/**: any member access of `.ipc` on a value.
  const emitterRe = /\.\s*ipc\s*\.\s*(\w+)\s*\(/g;
  let em;
  while ((em = emitterRe.exec(masked)) !== null) {
    violations.push(`${at(em.index)}: .ipc.${em[1]}( registers on a webContents' own IPC emitter — use the gate`);
  }

  // Indices of `ipcMain` tokens already accounted for by (a) / (b).
  /** @type {Set<number>} */
  const accounted = new Set();
  let rawCount = 0;
  let internalCount = 0;

  // (a) raw registrations — any `ipcMain.<member>` access.
  const memberRe = /\bipcMain\s*\.\s*(\w+)/g;
  let m;
  while ((m = memberRe.exec(masked))) {
    const idx = m.index;
    const member = m[1];
    if (member !== 'handle' && member !== 'on') {
      violations.push(`${at(idx)}: ipcMain.${member} is not a permitted registration form`);
      accounted.add(idx);
      continue;
    }
    const rest = masked.slice(memberRe.lastIndex);
    const lit = rest.match(/^\s*\(\s*(['"`])([^'"`\\\n]*)\1/);
    if (!rest.match(/^\s*\(/)) {
      violations.push(`${at(idx)}: ipcMain.${member} used other than as a direct registration call`);
    } else if (!lit || lit[1] === '`' || masked.slice(memberRe.lastIndex + lit[0].length).match(/^\s*\+/)) {
      violations.push(`${at(idx)}: registration channel is not a string literal`);
    } else {
      rawCount++;
      registrations.push({ channel: lit[2], form: 'raw', label: at(idx) });
      if (!exceptions.includes(lit[2])) {
        violations.push(
          `${at(idx)}: raw ipcMain.${member}('${lit[2]}') — no raw registration is permitted (use the gate)`
        );
      }
    }
    accounted.add(idx);
  }

  // (b) registerInternalHandler( / registerInternal( with ipcMain as first argument.
  const internalRe = /\bregisterInternal(?:Handler)?\s*\(\s*(ipcMain)\s*,\s*/g;
  while ((m = internalRe.exec(masked))) {
    const ipcIdx = m.index + m[0].indexOf('ipcMain');
    accounted.add(ipcIdx);
    const rest = masked.slice(internalRe.lastIndex);
    const lit = rest.match(/^(['"])([^'"\\\n]*)\1\s*,/);
    if (!lit) violations.push(`${at(ipcIdx)}: internal registration channel is not a string literal`);
    else {
      internalCount++;
      registrations.push({ channel: lit[2], form: 'internal', label: at(ipcIdx) });
    }
  }

  // Gate registrations.
  const gateRe = /\bgate\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(\s*/g;
  while ((m = gateRe.exec(masked))) {
    const cls = /** @type {Record<string, string>} */ (GATE_CLASS)[m[1]];
    if (!cls || (m[2] !== 'handle' && m[2] !== 'on' && m[2] !== 'sync')) {
      violations.push(`${at(m.index)}: unknown gate registrar gate.${m[1]}.${m[2]}`);
      continue;
    }
    const rest = masked.slice(gateRe.lastIndex);
    const lit = rest.match(/^(['"])([^'"\\\n]*)\1\s*,/);
    if (!lit) violations.push(`${at(m.index)}: gate registration channel is not a string literal`);
    else {
      // What follows the channel literal: a tab-guest switch object, or a sheet menu-type argument.
      const tail = rest.slice(lit[0].length);
      let extras = '';
      if (m[1] === 'tabGuest') {
        const sw = tail.match(/^\s*\{([^}]*)\}/);
        extras = sw
          ? sw[1]
              .split(',')
              .map((x) => x.trim())
              .filter((x) => /:\s*true$/.test(x))
              .map((x) => x.split(':')[0].trim())
              .sort()
              .join(',')
          : '?';
      } else if (m[1] === 'sheet') {
        const mt = tail.match(/^\s*SHEET_MENU_TYPES\[\s*(['"])([^'"\n]*)\1\s*\]\s*,/);
        extras = mt ? mt[2] : '?';
      }
      registrations.push({ channel: lit[2], form: 'gate', cls, label: at(m.index), method: m[2], extras });
    }
  }

  // Every other `ipcMain` token must sit in an enumerated context.
  const passesToRegistrar = new RegExp(
    `\\b(?:${[...REGISTRAR_CALLEES].join('|')})\\s*\\(\\s*\\{[^)]*?\\bipcMain\\b`
  ).test(masked);
  const holdsLegacyOrInternal = rawCount > 0 || internalCount > 0 || passesToRegistrar;
  void exceptions;
  for (const occ of ipcMainOccurrences(masked)) {
    if (accounted.has(occ.index)) continue;
    const where = at(occ.index);
    const before = masked.slice(0, occ.index).replace(/\s+$/, '');
    const after = masked.slice(occ.index + 'ipcMain'.length);
    const lastCh = before[before.length - 1];
    if (!/[{,]/.test(lastCh || '') || before.endsWith('...') || !/^\s*[,}]/.test(after)) {
      violations.push(`${where}: ipcMain used outside an enumerated context (assignment, spread, array or other)`);
      continue;
    }
    if (!occ.top || occ.top.ch !== '{') {
      violations.push(`${where}: ipcMain placed in an array/argument list`);
      continue;
    }
    const braceIdx = occ.top.index;
    const beforeBrace = masked.slice(0, braceIdx).replace(/\s+$/, '');
    const closeBrace = findMatchingBracket(masked, braceIdx, '{', '}');
    if (/\b(?:const|let|var)$/.test(beforeBrace)) {
      const tail = masked.slice(closeBrace + 1);
      // (c) a registrar's `const { ipcMain, ... } = deps;` parameter unpacking.
      if (/^\s*=\s*deps\s*;/.test(tail)) {
        if (!holdsLegacyOrInternal)
          violations.push(`${where}: ipcMain unpacked in a file with no ipcMain-registered channels`);
        continue;
      }
      // (e) the electron destructure, main.js only.
      if (base === 'main.js' && /^\s*=\s*require\(\s*['"]electron['"]\s*\)/.test(tail)) continue;
      violations.push(`${where}: ipcMain destructured from something other than main.js's require('electron')`);
      continue;
    }
    if (!beforeBrace.endsWith('(')) {
      violations.push(`${where}: ipcMain in an object that is neither a call argument nor a parameter list`);
      continue;
    }
    const parenIdx = beforeBrace.length - 1;
    const closeParen = findMatchingBracket(masked, parenIdx, '(', ')');
    const afterParen = masked.slice(closeParen + 1);
    if (/^\s*(?:=>|\{)/.test(afterParen)) {
      // (c) a destructured parameter.
      if (!holdsLegacyOrInternal) {
        violations.push(`${where}: ipcMain parameter in a file with no ipcMain-registered channels`);
      }
      continue;
    }
    const callee = beforeBrace.slice(0, parenIdx).match(/([\w$]+)\s*$/);
    if (!callee || !REGISTRAR_CALLEES.has(callee[1])) {
      violations.push(
        `${where}: ipcMain handed to '${callee ? callee[1] : '?'}', which is not an allowlisted registrar`
      );
    }
  }

  return { registrations, violations };
}

function scanTree() {
  const files = collectSources(MAIN_DIR);
  assert.ok(files.length > 20, `expected the src/main tree, found ${files.length} files`);
  /** @type {ReturnType<typeof scanSource>['registrations']} */
  const registrations = [];
  /** @type {string[]} */
  const violations = [];
  for (const file of files) {
    const label = path.relative(ROOT, file);
    const res = scanSource(fs.readFileSync(file, 'utf8'), { label, exceptions: RAW_EXCEPTIONS });
    registrations.push(...res.registrations);
    violations.push(...res.violations);
  }
  return { registrations, violations };
}

/** @param {Iterable<string>} a @param {Iterable<string>} b */
function symmetricDifference(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyInA: [...sa].filter((x) => !sb.has(x)).sort(),
    onlyInB: [...sb].filter((x) => !sa.has(x)).sort()
  };
}

const planted = (/** @type {string} */ src, label = 'src/main/register-planted-ipc.js') =>
  scanSource(src, { label, exceptions: RAW_EXCEPTIONS });

// --- the net on the real tree ----------------------------------------------------------

test('src/main/** has no registration or ipcMain use outside the enumerated contexts', () => {
  const { registrations, violations } = scanTree();
  assert.ok(registrations.length > 100, `scan found only ${registrations.length} registrations (vacuous?)`);
  assert.deepEqual(violations, []);
});

test('the scanned channels and the classification table are the same set, both directions', () => {
  const { registrations } = scanTree();
  const found = registrations.map((r) => r.channel);
  assert.ok(found.length > 0, 'the scan found nothing — vacuous');
  assert.equal(new Set(found).size, found.length, 'a channel is registered more than once');
  const diff = symmetricDifference(found, Object.keys(CHANNEL_CLASS));
  assert.deepEqual(diff.onlyInA, [], 'registered in source but missing from the table');
  assert.deepEqual(diff.onlyInB, [], 'in the table but never registered');
  assert.equal(found.length, EXPECTED_CHANNELS);
});

test('a gate registration names the class its table entry says; internal rows are classed internal', () => {
  const { registrations } = scanTree();
  for (const r of registrations) {
    if (r.form === 'gate') assert.equal(CHANNEL_CLASS[r.channel], r.cls, `${r.channel} at ${r.label}`);
    if (r.form === 'internal') assert.equal(CHANNEL_CLASS[r.channel], 'internal', `${r.channel} at ${r.label}`);
  }
});

test('LEGACY is gone: no export, an explicit empty exception list pinned at size 0, and no raw registration anywhere', () => {
  assert.equal('LEGACY' in ChannelTable, false, 'the table module must not export LEGACY');
  assert.equal(RAW_EXCEPTIONS.length, EXPECTED_RAW_EXCEPTIONS);
  assert.equal(EXPECTED_RAW_EXCEPTIONS, 0);
  const { registrations } = scanTree();
  assert.deepEqual(
    registrations.filter((r) => r.form === 'raw'),
    []
  );
  const src = fs.readFileSync(path.join(MAIN_DIR, 'ipc-channel-table.js'), 'utf8');
  assert.doesNotMatch(maskComments(src), /\bLEGACY\b/, 'no LEGACY identifier left in the table module');
});

test('the 91 formerly-raw channels are all gate-registered, by the class totals this leg states (25+26+19+1+1+6+13)', () => {
  assert.equal(FORMER_LEGACY.length, 91);
  assert.equal(new Set(FORMER_LEGACY).size, 91);
  const { registrations } = scanTree();
  const byChannel = new Map(registrations.map((r) => [r.channel, r]));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const c of FORMER_LEGACY) {
    const r = byChannel.get(c);
    assert.ok(r, `${c} is not registered`);
    assert.equal(r.form, 'gate', `${c} is not registered through the gate`);
    counts[CHANNEL_CLASS[c]] = (counts[CHANNEL_CLASS[c]] || 0) + 1;
  }
  assert.deepEqual(counts, {
    chrome: 25,
    'owning-chrome': 26,
    sheet: 19,
    find: 1,
    'find-or-owning-chrome': 1,
    'save-prompt': 6,
    'tab-guest': 13
  });
});

test('the class totals over the whole table are pinned', () => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const cls of Object.values(CHANNEL_CLASS)) counts[cls] = (counts[cls] || 0) + 1;
  assert.deepEqual(counts, EXPECTED_CLASS_COUNTS);
  assert.equal(Object.keys(CHANNEL_CLASS).length, EXPECTED_CHANNELS);
});

test('a sheet registration takes its menu types from its own row in the one table; every sheet row is registered', () => {
  const { registrations } = scanTree();
  const sheet = registrations.filter((r) => r.cls === 'sheet');
  assert.equal(sheet.length, 19);
  for (const r of sheet)
    assert.equal(r.extras, r.channel, `${r.channel} at ${r.label} must pass SHEET_MENU_TYPES['${r.channel}']`);
  assert.deepEqual(
    symmetricDifference(
      Object.keys(SHEET_MENU_TYPES),
      sheet.map((r) => r.channel)
    ),
    {
      onlyInA: [],
      onlyInB: []
    }
  );
  for (const [channel, row] of Object.entries(SHEET_MENU_TYPES)) {
    assert.equal(CHANNEL_CLASS[channel], 'sheet', channel);
    assert.ok(row === 'any-open-menu' || row === 'sender-only' || (Array.isArray(row) && row.length > 0), channel);
  }
  // `sender-only` is for the drag channel alone; the three un-typed ones are any-open-menu.
  const senderOnly = Object.entries(SHEET_MENU_TYPES).filter(([, row]) => row === 'sender-only');
  assert.deepEqual(
    senderOnly.map(([c]) => c),
    ['menu-overlay:sheet-drag']
  );
  assert.deepEqual(
    Object.entries(SHEET_MENU_TYPES)
      .filter(([, row]) => row === 'any-open-menu')
      .map(([c]) => c)
      .sort(),
    ['menu-overlay:activated', 'menu-overlay:dismissed', 'menu-overlay:refocus']
  );
});

test('every tab-guest registration states exactly its pinned switches ("popups", "internalTabs", "activeOnly" — and no others)', () => {
  const { registrations } = scanTree();
  const guest = registrations.filter((r) => r.cls === 'tab-guest');
  assert.equal(guest.length, 13);
  for (const r of guest) {
    assert.equal(r.extras, TAB_GUEST_SWITCHES[r.channel] ?? '', `${r.channel} at ${r.label}`);
    const wantSync = r.channel === 'shields-farble' || r.channel === 'vault-eligible';
    assert.equal(r.method, wantSync ? 'sync' : 'on', `${r.channel} must use the ${wantSync ? 'sync' : 'one-way'} form`);
  }
});

test('deleted channels are gone from the table', () => {
  for (const gone of [
    'history-page',
    'history-search',
    'history-delete',
    'history-clear',
    'history-count',
    'jars-cookies-list',
    'jars-cookies-remove',
    'jars-sitedata-list',
    'jars-sitedata-remove-origin'
  ]) {
    assert.equal(CHANNEL_CLASS[gone], undefined, gone);
  }
});

// --- scanner self-tests: each plant is the shape the net exists to catch ---------------

test("plant: a webContents' own .ipc.on / .ipc.handle / .ipc.once registration is a violation", () => {
  for (const member of ['on', 'handle', 'once']) {
    const r = planted(`function wire(wc) { wc.ipc.${member}('zz-planted', () => 1); }`);
    assert.ok(
      r.violations.some((v) => v.includes(`.ipc.${member}(`)),
      member
    );
  }
  const spaced = planted(`function wire(view) { view.webContents.ipc\n  .handle('zz', () => 1); }`);
  assert.equal(spaced.violations.length, 1);
  // a comment naming it is not a registration
  assert.deepEqual(planted(`// wc.ipc.on('x') is banned\nfunction f() {}`).violations, []);
});

test('plant: a bare ipcMain.handle of ANY channel is a violation (there is no exception list left)', () => {
  const r = planted(`function reg({ ipcMain }) { ipcMain.handle('zz-planted', () => 1); }`);
  assert.ok(
    r.violations.some((v) => /raw ipcMain\.handle\('zz-planted'\) — no raw registration is permitted/.test(v)),
    JSON.stringify(r.violations)
  );
});

test('plant: a raw registration of a FORMERLY-LEGACY channel name is a violation (the fifth neuter)', () => {
  for (const channel of FORMER_LEGACY) {
    const r = planted(`function reg({ ipcMain }) { ipcMain.on('${channel}', () => 1); }`);
    assert.ok(
      r.violations.some((v) => v.includes(`raw ipcMain.on('${channel}')`)),
      channel
    );
  }
});

test('plant: a registration by a computed or concatenated name is a violation', () => {
  const a = planted(`function reg({ ipcMain }) { const n = 'x'; ipcMain.handle(n, () => 1); }`);
  assert.ok(
    a.violations.some((v) => /not a string literal/.test(v)),
    JSON.stringify(a.violations)
  );
  const b = planted(`function reg({ ipcMain }) { ipcMain.on('a' + 'b', () => 1); }`);
  assert.ok(
    b.violations.some((v) => /not a string literal/.test(v)),
    JSON.stringify(b.violations)
  );
  const c = planted('function reg({ ipcMain }) { ipcMain.on(`tpl`, () => 1); }');
  assert.ok(
    c.violations.some((v) => /not a string literal/.test(v)),
    JSON.stringify(c.violations)
  );
});

test('plant: once / handleOnce / removeHandler and every other member are violations', () => {
  for (const member of ['once', 'handleOnce', 'removeHandler', 'addListener']) {
    const r = planted(`function reg({ ipcMain }) { ipcMain.${member}('zz', () => 1); }`);
    assert.ok(r.violations.length > 0, member);
  }
});

test('plant: aliasing, spreading and arraying ipcMain are violations', () => {
  const alias = planted(`function reg({ ipcMain }) { const x = ipcMain; x.handle('zz-planted', () => 1); }`);
  assert.ok(
    alias.violations.some((v) => /outside an enumerated context/.test(v)),
    JSON.stringify(alias.violations)
  );
  const spread = planted(`function reg({ ipcMain }) { return { ...ipcMain }; }`);
  assert.ok(spread.violations.length > 0);
  const arr = planted(`function reg({ ipcMain }) { return [ipcMain]; }`);
  assert.ok(arr.violations.length > 0);
  const arr2 = planted(`function reg({ ipcMain }) { return [1, ipcMain]; }`);
  assert.ok(arr2.violations.length > 0);
  const passed = planted(`function reg({ ipcMain }) { helper(ipcMain); }`);
  assert.ok(passed.violations.length > 0);
});

test('plant: handing ipcMain to a callee that is not an allowlisted registrar is a violation', () => {
  const r = planted(`function f() { somethingElse({ ipcMain, x: 1 }); }`);
  assert.ok(
    r.violations.some((v) => /not an allowlisted registrar/.test(v)),
    JSON.stringify(r.violations)
  );
});

test('permitted shapes pass: internal first-arg, parameter, registrar shorthand', () => {
  const r = planted(`
    function registerX({ ipcMain, registerInternalHandler }) {
      registerInternalHandler(ipcMain, 'internal-x', handler);
    }
    registerSettingsIpc({ ipcMain, gate });
  `);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(
    r.registrations.map((x) => [x.channel, x.form]),
    [['internal-x', 'internal']]
  );
});

test('plant: a registrar that registers nothing raw and takes an ipcMain parameter is a violation', () => {
  const r = planted(`function registerX({ ipcMain, gate }) { gate.chrome.on('a', () => 1); }`);
  assert.ok(
    r.violations.some((v) => /ipcMain parameter in a file with no ipcMain-registered channels/.test(v)),
    JSON.stringify(r.violations)
  );
});

test('a registration inside a comment is not seen', () => {
  const r = planted(`// ipcMain.handle('zz-planted', () => 1)\n/* ipcMain.on('zz', f) */ const x = 1;`);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.registrations, []);
});

test('gate registrations are found for every class and form, handler by reference or wrapped', () => {
  const r = planted(`
    gate.chrome.handle('a', handleA, 'throw');
    gate.chrome.on('b', catchLocked(handleB));
    gate.owningChrome.handle('c', (p) => p.wcId, handleC, 'throw');
    gate.chromeOrInternal.handle('d', () => 1, 'throw');
    gate.tabGuest.on('e', { popups: true, activeOnly: false }, h);
    gate.tabGuest.sync('f', {}, h, { value: 1 });
    gate.sheet.on('g', SHEET_MENU_TYPES['g'], h);
    gate.find.on('h', h);
    gate.savePrompt.handle('i', h, 'throw');
    gate.findOrOwningChrome.on('j', h);
  `);
  assert.deepEqual(
    r.registrations.map((x) => [x.channel, x.cls, x.method, x.extras]),
    [
      ['a', 'chrome', 'handle', ''],
      ['b', 'chrome', 'on', ''],
      ['c', 'owning-chrome', 'handle', ''],
      ['d', 'chrome-or-internal', 'handle', ''],
      ['e', 'tab-guest', 'on', 'popups'],
      ['f', 'tab-guest', 'sync', ''],
      ['g', 'sheet', 'on', 'g'],
      ['h', 'find', 'on', ''],
      ['i', 'save-prompt', 'handle', ''],
      ['j', 'find-or-owning-chrome', 'on', '']
    ]
  );
  const bad = planted(`gate.chrome.handle(name, h, 'throw');`);
  assert.ok(bad.violations.some((v) => /not a string literal/.test(v)));
});

test('the table-equality check goes red when one row is removed or one channel is planted', () => {
  const { registrations } = scanTree();
  const found = registrations.map((r) => r.channel);
  const keys = Object.keys(CHANNEL_CLASS);
  const dropped = keys.filter((k) => k !== 'settings-get');
  assert.notDeepEqual(symmetricDifference(found, dropped), { onlyInA: [], onlyInB: [] });
  const added = [...keys, 'zz-planted'];
  assert.notDeepEqual(symmetricDifference(found, added), { onlyInA: [], onlyInB: [] });
});
