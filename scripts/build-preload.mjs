#!/usr/bin/env node
// Bundles the web-guest preload into a single sandbox-loadable CJS file
// (flight/02 leg 1 — preload-bundling-infra). A sandboxed Electron preload's
// restricted module loader cannot resolve the two relative require()s in
// webview-preload.js (./vault-fill-fields, ./vault-fill-icon) — this step
// inlines them ahead of time so leg 2 can flip `sandbox: true` on the web
// guest without touching the preload's require graph.
//
// The two leaf sources (vault-fill-fields.js, vault-fill-icon.js) stay in
// place on disk — three unit tests require them directly. This bundle is an
// ADDITIONAL, generated, gitignored artifact; it is never committed and is
// regenerated at every launch/test/build entry point (see flight DD2).

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const entryPoint = path.join(repoRoot, 'src', 'preload', 'webview-preload.js');
const outfile = path.join(repoRoot, 'src', 'preload', 'webview-preload.bundle.js');

export async function buildPreloadBundle() {
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
      js: '/* GENERATED — do not edit; source: webview-preload.js. Regenerate: npm run build:preload */'
    }
  });
  return outfile;
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
