// Shared chrome renderer ownership: one DOM lookup pass and the cross-domain
// tab/view state. Feature controllers receive this object; they do not clone it.

const IDS = {
  tabstrip: 'tabstrip', tabs: 'tabs', newTab: 'new-tab', newTabMenu: 'new-tab-menu',
  winMin: 'win-min', winMax: 'win-max', winClose: 'win-close', webviews: 'webviews',
  back: 'back', forward: 'forward', reload: 'reload', address: 'address',
  toggleMedia: 'toggle-media', mediaCount: 'media-count', panel: 'media-panel',
  mediaList: 'media-list', mediaEmpty: 'media-empty', mediaStatus: 'media-status',
  tabStatus: 'tab-status', mediaClose: 'media-close', mediaRescan: 'media-rescan',
  mediaDownloadSelected: 'media-download-selected', toasts: 'toasts', lightbox: 'lightbox',
  lightboxStage: 'lightbox-stage', lightboxCaption: 'lightbox-caption',
  lightboxZoomLevel: 'lightbox-zoom-level', lightboxClose: 'lightbox-close',
  lightboxZoomIn: 'lightbox-zoom-in', lightboxZoomOut: 'lightbox-zoom-out',
  lightboxZoomReset: 'lightbox-zoom-reset', togglePrivacy: 'toggle-privacy',
  toggleDevtools: 'toggle-devtools', privacyCount: 'privacy-count', privacyPanel: 'privacy-panel',
  privacyBody: 'privacy-body', privacyClose: 'privacy-close', privacyRefresh: 'privacy-refresh',
  player: 'player', playerAudio: 'player-audio', playerTitle: 'player-title',
  playerProgress: 'player-progress', playerSeek: 'player-seek', playerCur: 'player-cur',
  playerDur: 'player-dur', playerPlay: 'player-play', playerPrev: 'player-prev',
  playerNext: 'player-next', kebab: 'kebab', addressChip: 'address-chip',
  automationIndicator: 'automation-indicator', automationIndicatorBadge: 'automation-indicator-badge',
  vaultIndicator: 'vault-indicator',
  zoomControl: 'zoom-control', zoomOut: 'zoom-out', zoomIn: 'zoom-in',
  zoomReset: 'zoom-reset', zoomPercent: 'zoom-percent'
};

export function createChromeContext({ document, goldfinch }) {
  const els = {};
  for (const [name, id] of Object.entries(IDS)) els[name] = document.getElementById(id);
  els.filters = document.querySelectorAll('.filter');
  document.documentElement.classList.add(`platform-${goldfinch?.platform ?? 'unknown'}`);
  return {
    els,
    tabs: new Map(),
    activeTabId: null,
    activeFilter: 'all',
    tabSeq: 0,
    activeViewWcId: null,
    rafGeometryPending: false,
  };
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
