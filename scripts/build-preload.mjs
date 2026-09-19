#!/usr/bin/env node
// Bundles the two sandboxed guest preloads into single sandbox-loadable CJS
// files (flight/02 leg 1 — preload-bundling-infra; extended M17 F1 L1, DD5), plus
// (Mission 21, Flight 1, Leg 3 — entry-tracker, DD3h) a THIRD, differently-shaped
// bundle: the isolated-world entry-observer install script.
//
// A sandboxed Electron preload's restricted module loader cannot resolve
// relative require()s:
//   - webview-preload.js (web branch): ./vault-fill-fields, ./vault-fill-icon,
//     ./vault-card-fields, ./guest-bookmark-drop, (M17 F1 L1) ../shared/
//     tab-boundary, (M21 F1 L3) ./vault-entry-tracker plus the GENERATED
//     ./vault-entry-observer-bundle.generated (built below, before this one),
//     and (M21 F1 L5) ./vault-gesture-policy.
//   - internal-preload.js (trusted/internal branch, sandboxed since its
//     construction — register-tab-ipc.js's trusted branch): previously had
//     zero relative requires, so it never needed bundling; M17 F1 L1 gives it
//     one (../shared/tab-boundary, the guest tab-exhaustion signal shared by
//     both guest preloads), so it now needs the same treatment.
//
// This step inlines each preload's require graph ahead of time. The leaf
// sources stay in place on disk — unit tests require them directly. All three
// bundles are ADDITIONAL, generated, gitignored artifacts; none is ever
// committed and all are regenerated at every launch/test/build entry point
// (see flight DD2/DD5).
//
// The THIRD bundle is a different shape entirely: `executeJavaScriptInIsolated-
// World` takes a plain STRING evaluated as a script — no `require`, no `module`
// — so vault-entry-observer-bootstrap.js (which composes the observer core +
// the two pure field modules) is bundled with esbuild's BROWSER/IIFE target
// (not the node/cjs target the other two use) and its output TEXT is wrapped in
// a small try/catch/return of our own (never relying on esbuild's own
// no-export bundle-wrapper completion value, and never relying on "a throw
// resolves undefined" as the SOLE failure signal — DD3h) and embedded as a
// generated JS constant that webview-preload.js requires normally.

import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const webEntryPoint = path.join(repoRoot, 'src', 'preload', 'webview-preload.js');
const webOutfile = path.join(repoRoot, 'src', 'preload', 'webview-preload.bundle.js');

const internalEntryPoint = path.join(repoRoot, 'src', 'preload', 'internal-preload.js');
const internalOutfile = path.join(repoRoot, 'src', 'preload', 'internal-preload.bundle.js');

const observerEntryPoint = path.join(repoRoot, 'src', 'preload', 'vault-entry-observer-bootstrap.js');
const observerOutfile = path.join(repoRoot, 'src', 'preload', 'vault-entry-observer-bundle.generated.js');

/**
 * @param {string} entryPoint
 * @param {string} outfile
 * @param {string} sourceBasename  for the GENERATED banner comment only
 */
async function bundleOne(entryPoint, outfile, sourceBasename) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    minify: false,
    logLevel: 'silent',
    banner: {
      js: `/* GENERATED — do not edit; source: ${sourceBasename}. Regenerate: npm run build:preload */`
    }
  });
  return outfile;
}

/**
 * Bundle vault-entry-observer-bootstrap.js (the observer core + the two pure
 * field modules) into a require/module-FREE isolated-world script string, wrap
 * it in a try/catch/return of our own, and write it out as a generated JS
 * constant (VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT).
 *
 * Two things esbuild's own output does NOT give us for free, both handled here:
 *   1. A bundle with no exports has no meaningful "last statement" completion
 *      value of its own — esbuild's own wrapping IIFE returns nothing. Wrapping
 *      the raw text in `(function () { try { <raw> } ... })()` and appending
 *      our OWN `return` statement is what gives executeJavaScriptInIsolated-
 *      World's resolved promise a definite shape to check, rather than relying
 *      on completion-value semantics of code we don't fully control the shape
 *      of.
 *   2. "Ran without throwing" is insufficient on its own (DD3h): the install is
 *      ALSO verified by checking the handle actually landed on `window` —
 *      catches the (unlikely but possible) case of a bootstrap that completed
 *      without attaching its handle.
 *
 * `module.exports`/CJS `require(...)` literally appear in esbuild's output
 * (its `__commonJS` interop wrapper preserves each inlined module's own
 * `module.exports = ...` line verbatim, scoped to that module's local `module`/
 * `exports` parameters — this was verified empirically, not assumed, during
 * this leg's design work) — they are SAFELY SCOPED there, never a reference to
 * an undefined global, which is what a NAIVE (non-bundled) concatenation would
 * produce. test/unit/vault-entry-observer-bundle.test.js verifies the actual
 * property that matters: the wrapped script runs cleanly in a sandbox with NO
 * `require`/`module` globals defined at all, and separately pins that no BARE
 * (word-boundary) call to a global `require(` survives — see that file for the
 * full rationale.
 */
async function buildObserverScript() {
  const result = await build({
    entryPoints: [observerEntryPoint],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    minify: false,
    logLevel: 'silent'
  });
  const raw = result.outputFiles[0].text;

  const { VAULT_ENTRY_OBSERVER_HANDLE } = require(
    path.join(repoRoot, 'src', 'preload', 'vault-entry-observer-handle.js')
  );
  const handleLiteral = JSON.stringify(VAULT_ENTRY_OBSERVER_HANDLE);

  const wrapped =
    '(function () {\n' +
    '  try {\n' +
    raw +
    '\n' +
    `    return { installed: !!(typeof window !== 'undefined' && window[${handleLiteral}]) };\n` +
    '  } catch (err) {\n' +
    '    return { installed: false, error: String((err && err.message) || err) };\n' +
    '  }\n' +
    '})();\n';

  const banner =
    '/* GENERATED — do not edit; source: vault-entry-observer-bootstrap.js. Regenerate: npm run build:preload */\n';
  const moduleSrc = `${banner}module.exports = { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT: ${JSON.stringify(wrapped)} };\n`;
  await fs.writeFile(observerOutfile, moduleSrc, 'utf8');
  return observerOutfile;
}

export async function buildPreloadBundle() {
  // The observer bundle MUST land on disk BEFORE webview-preload.js is bundled
  // — it require()s the generated file below (webview-preload.js's imports).
  const observer = await buildObserverScript();
  const [web, internal] = await Promise.all([
    bundleOne(webEntryPoint, webOutfile, 'webview-preload.js'),
    bundleOne(internalEntryPoint, internalOutfile, 'internal-preload.js')
  ]);
  return { web, internal, observer };
}

// Allow both `node scripts/build-preload.mjs` (npm script / hooks) and
// `import { buildPreloadBundle } from './build-preload.mjs'` (tests, the
// beforePack hook, dev-launch.mjs) without re-running the build twice.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildPreloadBundle().catch((err) => {
    console.error('[build:preload] failed:', err);
    process.exit(1);
  });
}
