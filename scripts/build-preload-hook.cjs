'use strict';

// electron-builder `beforePack` hook (flight/02 leg 1 — preload-bundling-infra).
//
// Regenerates the preload bundle before electron-builder copies app files for
// `pack`/`dist` (and the CI package/build tasks, which invoke electron-builder
// directly) — so a packaged build never ships a stale or missing
// webview-preload.bundle.js.
//
// Deliberately `beforePack`, NOT `beforeBuild`: electron-builder gates its own
// native-dependency rebuild on `beforeBuild`'s return value, so a hook that
// runs work there and doesn't `return true` would silently disable that
// rebuild (harmless today — no native deps — but a latent trap the moment one
// lands). `beforePack` has no such return-value semantics: it is unconditional
// (`void`) and fires before the file copy, so ordering is correct without any
// gating concern.
module.exports = async function buildPreloadBeforePack() {
  require('child_process').execSync('npm run build:preload', { stdio: 'inherit' });
};
