'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/media-controller.js')).href;

class El {
  constructor(name = 'el') {
    this.name = name; this.listeners = new Map(); this.children = []; this.dataset = {}; this.style = {};
    this.attributes = new Map(); this.textContent = ''; this.disabled = false; this.checked = false;
    this.offsetWidth = 100; this.offsetHeight = 100; this.paused = true; this.src = ''; this.duration = 0; this.currentTime = 0;
    this.classList = { values: new Set(), add: (...x) => x.forEach((v) => this.classList.values.add(v)), remove: (...x) => x.forEach((v) => this.classList.values.delete(v)), contains: (x) => this.classList.values.has(x), toggle: (x, on) => on ? this.classList.values.add(x) : this.classList.values.delete(x) };
  }
  set className(value) { value.split(/\s+/).filter(Boolean).forEach((x) => this.classList.add(x)); }
  set innerHTML(_value) { this.children = []; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  appendChild(child) { this.children.push(child); return child; }
  insertAdjacentHTML() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelector(selector) {
    if (!this.queries) this.queries = new Map();
    if (!this.queries.has(selector)) this.queries.set(selector, new El(selector));
    return this.queries.get(selector);
  }
  querySelectorAll() { return []; }
  contains(node) { return this.children.includes(node); }
  focus() { this.focused = true; }
  remove() { this.removed = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 400 }; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

function harness() {
  const names = ['panel','toggleMedia','address','mediaClose','mediaRescan','mediaCount','mediaList','mediaEmpty','mediaStatus','mediaDownloadSelected','lightbox','lightboxStage','lightboxZoomLevel','lightboxCaption','lightboxClose','lightboxZoomIn','lightboxZoomOut','lightboxZoomReset','playerAudio','playerTitle','player','playerPrev','playerNext','playerPlay','playerSeek','playerProgress','playerCur','playerDur','toasts'];
  const els = Object.fromEntries(names.map((name) => [name, new El(name)]));
  els.panel.classList.add('collapsed'); els.lightbox.classList.add('hidden'); els.player.classList.add('hidden');
  els.filters = [new El('all'), new El('image')]; els.filters[0].dataset.filter = 'all'; els.filters[1].dataset.filter = 'image';
  const document = { activeElement: null, listeners: new Map(), createElement: (name) => new El(name), addEventListener(name, fn) { this.listeners.set(name, fn); }, querySelectorAll: () => [] };
  const windowListeners = new Map();
  const calls = [];
  const window = { confirm: () => true, addEventListener: (name, fn) => windowListeners.set(name, fn), goldfinch: {
    rescanMedia: (x) => calls.push(['rescan', x]),
    downloadMedia: (x) => { calls.push(['download', x]); return Promise.resolve({ ok: true }); },
    chooseDownloadDir: async () => '/downloads', showItemInFolder: () => {},
    onDownloadProgress: () => {}, onDownloadDone: () => {}
  } };
  const tab = { id: 'tab', wcId: 7, media: [], selected: new Set(), internal: false };
  const toasts = [];
  const deps = {
    window, document, ctx: { activeFilter: 'all' }, els, activeTab: () => tab, isInternalTab: (t) => !!t.internal,
    closePrivacyPanel: () => {}, sendActiveBounds: () => {}, isSafePosterUrl: (url) => /^https:/.test(url || ''),
    toast: (...x) => toasts.push(x), persistentToast: () => new El('toast'), escapeHtml: String,
    openToolbarContextMenu: () => {}, createTab: (url) => calls.push(['create', url])
  };
  return { deps, els, tab, calls, toasts };
}

async function create(h) {
  const { createMediaController } = await import(moduleUrl);
  return createMediaController(h.deps);
}

test('filter rendering and selection operate on the active tab only', async () => {
  const h = harness();
  await create(h);
  h.tab.media = [
    { type: 'image', url: 'https://x/image.png', name: 'image.png' },
    { type: 'audio', url: 'https://x/audio.mp3', name: 'audio.mp3' }
  ];
  h.deps.ctx.activeFilter = 'image';
  h.els.filters[1].listeners.get('click')();
  assert.equal(h.els.mediaList.children.length, 1);
  assert.equal(h.els.mediaCount.textContent, '2');
  const checkbox = h.els.mediaList.children[0].children[0].children[0].children[0];
  checkbox.checked = true;
  checkbox.listeners.get('change')();
  assert.deepEqual([...h.tab.selected], ['https://x/image.png']);
  assert.equal(h.els.mediaDownloadSelected.disabled, false);
});

test('lightbox centers within stage bounds and restores focus on close', async () => {
  const h = harness();
  const controller = await create(h);
  const opener = new El('opener'); h.deps.document.activeElement = opener;
  controller.openLightbox({ type: 'image', url: 'https://x/image.png', name: 'Image' });
  const img = h.els.lightboxStage.children[0];
  img.listeners.get('load')();
  assert.equal(img.style.transform, 'translate(200px, 150px) scale(1)');
  assert.equal(h.els.lightbox.classList.contains('hidden'), false);
  controller.closeLightbox();
  assert.equal(h.els.lightbox.classList.contains('hidden'), true);
  assert.equal(opener.focused, true);
});

test('single and bulk download state share completion accounting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const controller = await create(h);
  const item = { type: 'image', url: 'https://x/image.png', name: 'image.png' };
  await controller.downloadItem(item, h.tab);
  assert.deepEqual(h.calls[0], ['download', { webContentsId: 7, url: item.url, suggestedName: item.name }]);

  h.tab.media = [item]; h.tab.selected.add(item.url);
  await controller.downloadSelected();
  assert.equal(controller.isBulkDownload(item.url), true);
  assert.equal(controller.consumeDownloadDone({ url: item.url, state: 'completed' }), true);
  assert.equal(controller.isBulkDownload(item.url), false);
});

test('audio playlist navigation follows the active tab media order', async () => {
  const h = harness();
  const controller = await create(h);
  const one = { type: 'audio', url: 'https://x/one.mp3', name: 'One' };
  const two = { type: 'audio', url: 'https://x/two.mp3', name: 'Two' };
  h.tab.media = [one, two];
  controller.playAudio(one);
  assert.equal(h.els.playerAudio.src, one.url);
  controller.playNext();
  assert.equal(h.els.playerAudio.src, two.url);
  controller.playPrev();
  assert.equal(h.els.playerAudio.src, one.url);
});
