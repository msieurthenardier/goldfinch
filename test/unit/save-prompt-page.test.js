'use strict';

// Sortie 06 Leg 1 (AC22): source-scan pins on the prompt page, its preload and its HTML.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Leg 3 R7 (narrows AC22): save-prompt.js has exactly ONE `.focus(` site, inside focusPrimary(); no autofocus (comments masked, vacuity-guarded)', () => {
  const raw = read('src/renderer/save-prompt.js');
  const masked = maskComments(raw);
  assert.ok(masked.length > 500 && masked.includes('onInit'), 'vacuity guard: the real page source was scanned');
  const hits = [...masked.matchAll(/\.focus\s*\(/g)];
  assert.equal(hits.length, 1);
  const fnAt = masked.indexOf('function focusPrimary');
  assert.notEqual(fnAt, -1);
  const open = masked.indexOf('{', fnAt);
  const close = findMatchingBracket(masked, open, '{', '}');
  assert.ok(hits[0].index > open && hits[0].index < close, 'the one site is inside focusPrimary');
  assert.equal(/\bautofocus\b/.test(masked), false);
  // vacuity mutation: an injected second site goes red
  assert.equal([...(masked + '\nel.focus();').matchAll(/\.focus\s*\(/g)].length, 2);
  const callers = [...masked.matchAll(/focusPrimary\(\)/g)].length;
  assert.ok(callers >= 3, 'definition + the focus-first handler + the post-repaint restore');
});

test('Leg 3 AC4: the page installs NO keydown handler (Tab / Shift+Tab / Enter stay native)', () => {
  const masked =
    maskComments(read('src/renderer/save-prompt.js')) + maskComments(read('src/shared/vault-capture-template.js'));
  assert.equal(/keydown|keyup|keypress|onkey/i.test(masked), false);
});

test('Leg 3 AC8/R9: the prompt has its OWN polite role=status node (sibling of the root); text omits "Press F6"; no aria-modal', () => {
  const html = read('src/renderer/save-prompt.html');
  assert.match(html, /<div id="save-prompt-announce" class="sr-only" role="status" aria-live="polite"><\/div>/);
  assert.ok(html.indexOf('id="save-prompt-announce"') > html.indexOf('id="save-prompt-root"></div>'));
  const page = maskComments(read('src/renderer/save-prompt.js'));
  assert.match(page, /savePromptAnnouncement\(d\.model\)/);
  assert.equal(/withHint/.test(page), false);
  assert.match(read('src/renderer/save-prompt.css'), /\.sr-only\s*\{/);
});

test('AC22: the page is textContent-only - no innerHTML / outerHTML / insertAdjacentHTML / document.write', () => {
  const masked =
    maskComments(read('src/renderer/save-prompt.js')) + maskComments(read('src/shared/vault-capture-template.js'));
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(masked), false);
});

test('AC22: save-prompt.html is file:// with a strict CSP (no remote loads) and a module script', () => {
  const html = read('src/renderer/save-prompt.html');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'; style-src 'self'; script-src 'self'/);
  assert.match(html, /<script src="save-prompt\.js" type="module"><\/script>/);
  assert.equal(/https?:/.test(html), false);
});

test('AC22: the preload exposes ONLY window.savePrompt (never window.goldfinch) and no page->main focus-moving channel (Leg 3: a main->page onFocusFirst listener is allowed)', () => {
  const src = maskComments(read('src/preload/save-prompt-preload.js'));
  assert.equal((src.match(/exposeInMainWorld\(/g) || []).length, 1);
  assert.match(src, /exposeInMainWorld\('savePrompt'/);
  assert.equal(/'goldfinch'/.test(src), false);
  // every channel it touches is in the save-prompt: namespace
  const channels = [...src.matchAll(/ipcRenderer\.(?:send|invoke|on)\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(channels.length >= 8);
  for (const c of channels) assert.ok(c.startsWith('save-prompt:'), c);
  // page->main sends/invokes: none moves focus (focusInside only REPORTS presence)
  const outbound = [...src.matchAll(/ipcRenderer\.(?:send|invoke)\('([^']+)'/g)].map((m) => m[1]);
  for (const c of outbound) assert.equal(/focus-first|focus-prompt|focus-guest|key/.test(c), false, c);
  assert.match(src, /onFocusFirst: \(cb\) => ipcRenderer\.on\('save-prompt:focus-first'/);
});

test('AC22: the rendered card is NON-MODAL - root role=dialog with aria-labelledby/-describedby, no aria-modal, no backdrop', () => {
  const src = maskComments(read('src/shared/vault-capture-template.js'));
  assert.ok(src.includes('buildVaultCaptureCard'), 'vacuity guard');
  assert.equal(src.includes('aria-modal'), false);
  assert.equal(src.includes('sheet-vault-capture'), false);
  assert.match(src, /setAttribute\('role', 'dialog'\)/);
  assert.match(src, /setAttribute\('aria-labelledby'/);
  assert.match(src, /setAttribute\('aria-describedby'/);
});

test('AC22: the view is contextIsolation:true, sandbox:true, nodeIntegration:false with only the save-prompt preload (window-factory)', () => {
  const src = maskComments(read('src/main/window-factory.js'));
  const i = src.indexOf('function createSavePromptView');
  assert.notEqual(i, -1);
  const body = src.slice(i, i + 700);
  assert.match(body, /preload:\s*paths\.savePromptPreload/);
  assert.match(body, /contextIsolation:\s*true/);
  assert.match(body, /nodeIntegration:\s*false/);
  assert.match(body, /sandbox:\s*true/);
  assert.match(body, /setBackgroundColor\('#00000000'\)/);
});

test("Leg 2 AC3/AC5: a LOCKED model's primary drives bridge.consent (never bridge.save); the preload exposes consent on save-prompt:consent", () => {
  const page = maskComments(read('src/renderer/save-prompt.js'));
  assert.match(page, /state\.model\.mode === 'locked'/);
  assert.match(page, /bridge\.consent\(/);
  const consentAt = page.indexOf('bridge.consent(');
  const saveAt = page.indexOf('bridge.save(');
  assert.ok(consentAt > 0 && saveAt > consentAt, 'the locked branch returns before the plain save');
  assert.match(maskComments(read('src/preload/save-prompt-preload.js')), /'save-prompt:consent'/);
});
