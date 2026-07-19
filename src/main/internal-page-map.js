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
    }
  };
}

module.exports = { createInternalPageMap };
