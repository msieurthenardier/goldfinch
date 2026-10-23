'use strict';

// Script-tag contract test for the goldfinch://automation internal page (sortie 05),
// sibling to settings-page-shared-scripts.test.js. Flat script srcs resolve through the
// INTERNAL_PAGES map, so a typo'd src 404s only at boot; this is the static net. Also
// pins the page contract (title, sections, hints) and the shared `section-nav` shell class.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInternalPageMap } = require('../../src/main/internal-page-map');

const PAGES_DIR = path.join(__dirname, '../../src/renderer/pages');
const MAIN_DIR = path.join(__dirname, '../../src/main');
const HTML = fs.readFileSync(path.join(PAGES_DIR, 'automation.html'), 'utf8');
const SETTINGS_HTML = fs.readFileSync(path.join(PAGES_DIR, 'settings.html'), 'utf8');
const SETTINGS_CSS = fs.readFileSync(path.join(PAGES_DIR, 'settings.css'), 'utf8');

function scriptTags(html) {
  const tags = [];
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    const src = /\bsrc="([^"]+)"/.exec(m[1]);
    if (!src) continue;
    tags.push({ src: src[1], isModule: /\btype="module"/.test(m[1]) });
  }
  return tags;
}

test('automation.html loads automation.js and every script is type="module"', () => {
  const tags = scriptTags(HTML);
  assert.ok(tags.some((t) => t.src === 'automation.js'));
  for (const t of tags) assert.ok(t.isModule, `${t.src} must be type="module"`);
  assert.equal((HTML.match(/<script\b/g) || []).length, tags.length, 'no inline or classic scripts');
});

test('every automation.html script src and stylesheet is routed on the automation host and exists on disk', () => {
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path }).automation;
  assert.ok(map, 'automation host entry exists');
  const hrefs = [...HTML.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['settings.css', 'automation.css'], 'settings.css first, then automation.css');
  for (const src of [...scriptTags(HTML).map((t) => t.src), ...hrefs]) {
    const file = map['/' + src];
    assert.ok(file, `"${src}" must be routed on the automation host`);
    assert.ok(fs.existsSync(file), `"${src}" routes to a missing file ${file}`);
  }
});

test('automation.js imports its flat siblings with @ts-ignore and each is routed', () => {
  const js = fs.readFileSync(path.join(PAGES_DIR, 'automation.js'), 'utf8');
  const map = createInternalPageMap({ baseDir: MAIN_DIR, path }).automation;
  const imports = [...js.matchAll(/^import\s*\{[^}]*\}\s*from\s*'\.\/([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['audit-paging.js', 'safe-color.js', 'section-scroll-spy.js']);
  for (const i of imports) assert.ok(map['/' + i], i);
  assert.match(js, /initSectionScrollSpy\(\s*\{\s*document,\s*IntersectionObserver\s*\}\s*\)/);
});

test('page contract: title, section ids, nav anchors, headings', () => {
  assert.match(HTML, /<title>Automation — Goldfinch<\/title>/);
  assert.match(HTML, /<nav class="section-nav" aria-label="Automation sections">/);
  for (const id of ['connection', 'keys', 'activity']) {
    assert.match(HTML, new RegExp(`<section id="${id}">\\s*<h2>`));
    assert.match(HTML, new RegExp(`<a href="#${id}">`));
  }
  assert.match(HTML, /<h1>Automation<\/h1>/);
});

test('the two agreed hint strings are present verbatim (whitespace-normalized)', () => {
  const flat = HTML.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes('Each key is scoped to one cookie jar. To create a new jar, open Cookie jars from the … menu.')
  );
  assert.ok(
    flat.includes(
      "An agent unlocks a jar's vault with a separate vault access key. Mint one in Vault (… menu) under that jar's Access keys."
    )
  );
});

test('the hint paragraphs sit after the jar list and the key reveal, before the admin block', () => {
  const jars = HTML.indexOf('id="automation-jars"');
  const reveal = HTML.indexOf('id="automation-key-reveal"');
  const hints = HTML.indexOf('Each key is scoped');
  const vaultHint = HTML.indexOf('An agent unlocks');
  const admin = HTML.indexOf('id="automation-admin"');
  assert.ok(jars > -1 && reveal > jars, 'jar list precedes key reveal');
  assert.ok(hints > reveal && vaultHint > hints, 'hints follow the key reveal, in order');
  assert.ok(admin > vaultHint, 'hints precede the admin block');
});

test('both pages share the section-nav shell class and settings.css has no aria-label selector for it', () => {
  assert.match(SETTINGS_HTML, /<nav class="section-nav" aria-label="Settings sections">/);
  assert.match(HTML, /<nav class="section-nav" aria-label="Automation sections">/);
  assert.ok(/nav\.section-nav\b/.test(SETTINGS_CSS), 'settings.css styles nav.section-nav');
  assert.doesNotMatch(SETTINGS_CSS, /aria-label\s*=\s*['"]?Settings sections/);
  assert.doesNotMatch(SETTINGS_CSS, /\[aria-label/);
});

test('Settings no longer carries the Automation section, nav entry, or its scripts', () => {
  assert.doesNotMatch(SETTINGS_HTML, /id="automation/);
  assert.doesNotMatch(SETTINGS_HTML, /href="#automation"/);
  assert.doesNotMatch(SETTINGS_HTML, /audit-paging\.js|safe-color\.js/);
  const js = fs.readFileSync(path.join(PAGES_DIR, 'settings.js'), 'utf8');
  assert.doesNotMatch(js, /automation|copyText|audit-paging|safe-color/);
});
