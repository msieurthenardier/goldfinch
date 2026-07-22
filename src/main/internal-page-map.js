'use strict';

// Exact host/path allowlist for goldfinch:// assets. URL pathnames are never
// used for filesystem arithmetic; adding a subresource requires an entry here.
// This is the three-point internal-module onboarding seam: map entry, module
// tag/import, and script-contract test. There is deliberately no directory
// passthrough, including in packaged asar:false builds.
function createInternalPageMap({ baseDir, path }) {
  const rendererPage = (file) => path.join(baseDir, '..', 'renderer', 'pages', file);
  const shared = (file) => path.join(baseDir, '..', 'shared', file);
  return {
    settings: {
      '/': rendererPage('settings.html'),
      '/settings.css': rendererPage('settings.css'),
      '/settings.js': rendererPage('settings.js'),
      // Same-origin shared modules must be explicitly served: disk-relative
      // ../shared imports have no route in the custom scheme.
      '/audit-paging.js': shared('audit-paging.js'),
      '/safe-color.js': shared('safe-color.js')
    },
    // App-level downloads surface; save-path authority remains main-side.
    downloads: {
      '/': rendererPage('downloads.html'),
      '/downloads.css': rendererPage('downloads.css'),
      '/downloads.js': rendererPage('downloads.js')
    },
    // Jar management plus its shared decisions and page-local controllers.
    jars: {
      '/': rendererPage('jars.html'),
      '/jars.css': rendererPage('jars.css'),
      '/jars.js': rendererPage('jars.js'),
      '/jars-page-state.js': rendererPage('jars-page-state.js'),
      '/jars-nav-controller.js': rendererPage('jars-nav-controller.js'),
      '/jars-section-controller.js': rendererPage('jars-section-controller.js'),
      '/jars-create-controller.js': rendererPage('jars-create-controller.js'),
      '/jar-page-model.js': shared('jar-page-model.js'),
      '/safe-color.js': shared('safe-color.js'),
      '/burner.js': shared('burner.js'),
      '/jar-data-classes.js': shared('jar-data-classes.js'),
      '/jar-panel-model.js': shared('jar-panel-model.js'),
      '/jars-history-panel.js': rendererPage('jars-history-panel.js'),
      '/jars-tabs.js': rendererPage('jars-tabs.js'),
      '/jars-confirm-modal.js': rendererPage('jars-confirm-modal.js'),
      '/jars-cookies-panel.js': rendererPage('jars-cookies-panel.js'),
      '/jars-sitedata-panel.js': rendererPage('jars-sitedata-panel.js')
    },
    // Password-vault management page (M12 Flight 3). The strict internal CSP has no
    // directory passthrough, so every shared module the page imports needs its own
    // exact entry here (the three-point onboarding seam). Leg 1 imports only the pure
    // state model; later legs add the editor/generator/totp modules with their routes.
    vault: {
      '/': rendererPage('vault.html'),
      '/vault.css': rendererPage('vault.css'),
      '/vault.js': rendererPage('vault.js'),
      '/vault-page-model.js': shared('vault-page-model.js'),
      // Leg 2: the pure editor logic (unchanged-secret assembly + mask/reveal state
      // + http/https origin-link guard) the page imports as a flat ESM specifier.
      '/vault-editor-model.js': shared('vault-editor-model.js'),
      // Leg 3: the pure password generator (DD7) the editor imports as a flat specifier.
      '/password-generator.js': shared('password-generator.js'),
      // M12 F5 HAT hat-page-sidebar (nav+main restructure): the pure nav-entry model lives in
      // vault-page-model.js (already routed above); the page also imports the injection-safe
      // color validator (for jar-dot colors) and the mirrored nav controller.
      '/safe-color.js': shared('safe-color.js'),
      '/vault-nav-controller.js': rendererPage('vault-nav-controller.js')
    }
  };
}

module.exports = { createInternalPageMap };
