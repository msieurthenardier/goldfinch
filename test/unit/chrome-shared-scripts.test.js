'use strict';

// Script-tag contract tests for the renderer and internal-page documents.
// Everything here is self-derived from the real HTML files on disk — one
// glob over src/renderer/**/*.html, never a hand-maintained list — so the
// pins track the documents' actual script sets without drifting.
//
// Contracts pinned (M07 Flight 2, ESM conversion end-state):
//
//   1. Tag-count guard: index.html still loads its src/shared/ scripts. A
//      markup or regex drift that silently parsed ZERO tags would make every
//      other pin vacuously green — this guard fails first instead.
//   2. DD3, now the PERMANENT rule (all documents): on any page that loads at
//      least one module script, every classic <script> tag must carry
//      `defer`. Module scripts always execute after parse; a non-defer
//      classic executes DURING parse — before every module, inverting
//      document order. menu-overlay.html's classic menu-controller.js (the
//      DD6 carve-out, the product's one remaining classic script) is the live
//      binding case.
//   3. Module pin (all documents): every <script> tag that resolves to a
//      src/shared/*.js file is type="module". src/shared/ is real ESM as of
//      this flight — a classic tag on an ESM file is a parse-time
//      SyntaxError that only a live boot would otherwise catch.
//
// History: until M07 Flight 2 this file was a shared-scope vm-replay net.
// Classic (non-module) <script> tags all share ONE top-level lexical
// environment per document, so two classic scripts independently declaring
// the same top-level const/let/class collided at parse time — fatal on a real
// boot, invisible to the require()-based unit suite (M06 F2 Leg 3 D1 hit
// exactly this). The net replayed every classic shared tag in one Node `vm`
// context to catch collisions statically. The ESM conversion made that class
// structurally impossible (module scripts get their own scope), so the replay
// machinery retired with the conversion's retire-machinery leg — see
// missions/07-maintenance/flights/02-esm-conversion/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const RENDERER_DIR = path.join(REPO_ROOT, 'src/renderer');
const SHARED_DIR = path.join(REPO_ROOT, 'src/shared');
const INDEX_HTML = path.join(RENDERER_DIR, 'index.html');

// Parse EVERY <script ... src="..."> tag straight out of an HTML document, in
// document order. Attribute parsing is order-insensitive (src / type="module"
// / defer may appear in any order inside the tag).
function scriptTags(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const tags = [];
  const re = /<script\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const srcMatch = /\bsrc="([^"]+\.js)"/.exec(attrs);
    if (!srcMatch) continue;
    tags.push({
      src: srcMatch[1],
      isModule: /\btype="module"/.test(attrs),
      hasDefer: /\bdefer\b/.test(attrs)
    });
  }
  return tags;
}

// Every renderer/internal-page document, self-derived from the tree.
function rendererDocuments() {
  return fs
    .readdirSync(RENDERER_DIR, { recursive: true })
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => path.join(RENDERER_DIR, f));
}

// A tag references a src/shared/ file when its src points there explicitly
// (index.html / menu-overlay.html use ../shared/ relative paths) or when its
// flat name exists in src/shared/ (internal pages serve shared files via flat
// srcs resolved through the INTERNAL_PAGES protocol map in main.js).
// Resolution is by existence, not a hardcoded list. No page-local script name
// collides with a src/shared/ name today; if one ever did, this pin would
// flag the tag and the collision would get resolved by renaming — safer than
// silently skipping a real shared file.
function isSharedSrc(src) {
  if (src.includes('../shared/')) return true;
  if (src.includes('/')) return false;
  return fs.existsSync(path.join(SHARED_DIR, src));
}

function repoRel(file) {
  return path.relative(REPO_ROOT, file);
}

test('index.html shared-script load order is non-empty (guards against a silent parse regression)', () => {
  const shared = scriptTags(INDEX_HTML).filter((t) => isSharedSrc(t.src));
  assert.ok(shared.length >= 5, 'expected several ../shared/*.js <script> tags in index.html');
});

test('DD3 pin, all documents: a classic script tag on a page with module scripts carries defer', () => {
  for (const doc of rendererDocuments()) {
    const tags = scriptTags(doc);
    if (!tags.some((t) => t.isModule)) continue; // the rule binds only on pages that load module scripts
    for (const t of tags) {
      if (t.isModule) continue;
      assert.ok(
        t.hasDefer,
        `${repoRel(doc)} loads "${t.src}" as a non-defer classic script on a page with module scripts — ` +
          'it would execute during parse, BEFORE any module, inverting document order (DD3)'
      );
    }
  }
});

test('module pin, all documents: every src/shared/*.js script tag is type="module"', () => {
  for (const doc of rendererDocuments()) {
    for (const t of scriptTags(doc)) {
      if (!isSharedSrc(t.src)) continue;
      assert.ok(
        t.isModule,
        `${repoRel(doc)} loads the shared file "${t.src}" as a classic script — src/shared/ is ESM, ` +
          'and a classic tag on an ESM file is a parse-time SyntaxError only a live boot would catch'
      );
    }
  }
});
