'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/media-controller.js')).href;

class El {
  constructor(name = 'el') {
    this.name = name;
    this.listeners = new Map();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.offsetWidth = 100;
    this.offsetHeight = 100;
    this.paused = true;
    this.src = '';
    this.duration = 0;
    this.currentTime = 0;
    this.classList = {
      values: new Set(),
      add: (...x) => x.forEach((v) => this.classList.values.add(v)),
      remove: (...x) => x.forEach((v) => this.classList.values.delete(v)),
      contains: (x) => this.classList.values.has(x),
      toggle: (x, on) => (on ? this.classList.values.add(x) : this.classList.values.delete(x))
    };
  }
  set className(value) {
    value
      .split(/\s+/)
      .filter(Boolean)
      .forEach((x) => this.classList.add(x));
  }
  set innerHTML(_value) {
    this.children = [];
  }
  addEventListener(name, fn) {
    this.listeners.set(name, fn);
  }
  removeEventListener(name, fn) {
    if (this.listeners.get(name) === fn) this.listeners.delete(name);
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  insertAdjacentHTML() {}
  removeAttribute(name) {
    if (name === 'src') this.src = '';
    this.attributes.delete(name);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  querySelector(selector) {
    if (!this.queries) this.queries = new Map();
    if (!this.queries.has(selector)) this.queries.set(selector, new El(selector));
    return this.queries.get(selector);
  }
  querySelectorAll() {
    return [];
  }
  contains(node) {
    return this.children.includes(node);
  }
  focus() {
    this.focused = true;
  }
  remove() {
    this.removed = true;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 500, height: 400 };
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function harness() {
  const names = [
    'panel',
    'toggleMedia',
    'address',
    'mediaClose',
    'mediaRescan',
    'mediaCount',
    'mediaList',
    'mediaEmpty',
    'mediaStatus',
    'mediaDownloadSelected',
    'lightbox',
    'lightboxStage',
    'lightboxZoomLevel',
    'lightboxCaption',
    'lightboxClose',
    'lightboxZoomIn',
    'lightboxZoomOut',
    'lightboxZoomReset',
    'playerAudio',
    'playerTitle',
    'player',
    'playerPrev',
    'playerNext',
    'playerPlay',
    'playerSeek',
    'playerProgress',
    'playerCur',
    'playerDur',
    'toasts'
  ];
  const els = Object.fromEntries(names.map((name) => [name, new El(name)]));
  els.panel.classList.add('collapsed');
  els.lightbox.classList.add('hidden');
  els.player.classList.add('hidden');
  els.filters = [new El('all'), new El('image')];
  els.filters[0].dataset.filter = 'all';
  els.filters[1].dataset.filter = 'image';
  const document = {
    activeElement: null,
    listeners: new Map(),
    createElement: (name) => new El(name),
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    },
    querySelectorAll: () => []
  };
  const windowListeners = new Map();
  const calls = [];
  const window = {
    confirm: () => true,
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    goldfinch: {
      rescanMedia: (x) => calls.push(['rescan', x]),
      downloadMedia: (x) => {
        calls.push(['download', x]);
        return Promise.resolve({ ok: true });
      },
      chooseDownloadDir: async () => '/downloads',
      showItemInFolder: () => {},
      onDownloadProgress: () => {},
      onDownloadDone: () => {}
    }
  };
  const tab = { id: 'tab', wcId: 7, mediaToken: 'tok7', media: [], selected: new Set(), internal: false };
  const toasts = [];
  const deps = {
    window,
    document,
    ctx: { activeFilter: 'all' },
    els,
    activeTab: () => tab,
    isInternalTab: (t) => !!t.internal,
    closePrivacyPanel: () => {},
    sendActiveBounds: () => {},
    isSafePosterUrl: (url) => /^https:/.test(url || ''),
    // Same contract as the real builder: null unless a token and an http(s) url.
    toMediaProxyUrl: (token, url) => (token && /^https?:/.test(url || '') ? `proxy:${token}:${url}` : null),
    toast: (...x) => toasts.push(x),
    persistentToast: () => new El('toast'),
    escapeHtml: String,
    openToolbarContextMenu: () => {},
    createTab: (url) => calls.push(['create', url])
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
  const opener = new El('opener');
  h.deps.document.activeElement = opener;
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

  h.tab.media = [item];
  h.tab.selected.add(item.url);
  await controller.downloadSelected();
  assert.equal(controller.isBulkDownload(item.url), true);
  assert.equal(controller.consumeDownloadDone({ url: item.url, state: 'completed' }), true);
  assert.equal(controller.isBulkDownload(item.url), false);
});

// Mission 23 Flight 1 (`ipc-gate-complete`): the gate REFUSES a download that names a tab the
// sender window does not own (a tab closed mid-batch), so the invoke rejects. The pump must count
// the item failed and keep going, and nothing may surface as an unhandled rejection.
test('bulk download: a rejected downloadMedia marks the item failed and the pump continues (no unhandled rejection)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const controller = await create(h);
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    h.deps.window.goldfinch.downloadMedia = (x) => {
      h.calls.push(['download', x]);
      return x.url.endsWith('/a.png') ? Promise.reject(new Error('forbidden')) : Promise.resolve({ ok: true });
    };
    const a = { type: 'image', url: 'https://x/a.png', name: 'a.png' };
    const b = { type: 'image', url: 'https://x/b.png', name: 'b.png' };
    h.tab.media = [a, b];
    h.tab.selected.add(a.url);
    h.tab.selected.add(b.url);
    await controller.downloadSelected();
    // Let the rejection handler run (promise jobs only; no timers needed).
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.isBulkDownload(a.url), false, 'the rejected item is no longer pending');
    assert.equal(controller.isBulkDownload(b.url), true, 'the other item is still in flight (the pump continued)');
    assert.equal(controller.consumeDownloadDone({ url: b.url, state: 'completed' }), true);
    assert.equal(controller.isBulkDownload(b.url), false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('single download: a rejected downloadMedia toasts a failure instead of throwing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const controller = await create(h);
  h.deps.window.goldfinch.downloadMedia = () => Promise.reject(new Error('forbidden'));
  await controller.downloadItem({ type: 'image', url: 'https://x/a.png', name: 'a.png' }, h.tab);
  assert.equal(h.els.toasts.children.length, 1, 'one failure toast was shown');
});

test('audio playlist navigation follows the active tab media order', async () => {
  const h = harness();
  const controller = await create(h);
  const one = { type: 'audio', url: 'https://x/one.mp3', name: 'One' };
  const two = { type: 'audio', url: 'https://x/two.mp3', name: 'Two' };
  h.tab.media = [one, two];
  controller.playAudio(one);
  assert.equal(h.els.playerAudio.src, `proxy:${h.tab.mediaToken}:${one.url}`);
  controller.playNext();
  assert.equal(h.els.playerAudio.src, `proxy:${h.tab.mediaToken}:${two.url}`);
  controller.playPrev();
  assert.equal(h.els.playerAudio.src, `proxy:${h.tab.mediaToken}:${one.url}`);
});

test('image thumb, poster, inline player, lightbox, and docked audio all route through the media proxy (Mission 13 F1 Leg 2 / DD2/AC3)', async () => {
  const h = harness();
  const controller = await create(h);
  const image = { type: 'image', url: 'https://x/pic.png', name: 'pic.png' };
  const video = { type: 'video', url: 'https://x/vid.mp4', poster: 'https://x/poster.png', name: 'vid.mp4' };
  h.tab.media = [image, video];
  h.tab.selected = new Set();

  // renderMedia builds cards via els.mediaList — drive it the same way the app does.
  h.deps.ctx.activeFilter = 'all';
  controller.renderMedia();
  const cards = h.els.mediaList.children;
  assert.equal(cards.length, 2);

  const imgEl = cards[0].children[0].children[1]; // card -> thumb -> [pick, img]
  assert.equal(imgEl.src, `proxy:${h.tab.mediaToken}:${image.url}`);

  const videoThumb = cards[1].children[0]; // card -> thumb
  assert.equal(videoThumb.style.backgroundImage, `url("proxy:${h.tab.mediaToken}:${video.poster}")`);

  // Lightbox and inline player resolve activeTab() at call time.
  controller.openLightbox(image);
  const lightboxImg = h.els.lightboxStage.children[0];
  assert.equal(lightboxImg.src, `proxy:${h.tab.mediaToken}:${image.url}`);
});

// Squawk 0032: toast auto-dismiss must pause on hover/focus and resume with the
// REMAINING time (WCAG 2.2.1). Date is mocked alongside setTimeout so armDismiss's
// Date.now()-based elapsed tracking advances in lockstep with tick().

test('squawk 0032: a toast left alone auto-dismisses at the full deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness();
  const controller = await create(h);
  const el = controller.toast('Title', 'Body');

  t.mock.timers.tick(4999);
  assert.equal(el.removed, undefined);
  t.mock.timers.tick(1);
  assert.equal(el.removed, true);
});

test('squawk 0032: hovering pauses the dismiss countdown and mouseleave resumes with the remaining time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness();
  const controller = await create(h);
  const el = controller.toast('Title', 'Body');

  t.mock.timers.tick(3000); // t=3s into the 5000ms deadline: 2000ms remaining
  el.listeners.get('mouseenter')();
  t.mock.timers.tick(7000); // t=10s while paused — untouched
  assert.equal(el.removed, undefined);
  el.listeners.get('mouseleave')(); // resumes with the 2000ms remaining, not a fresh 5000ms
  t.mock.timers.tick(1999);
  assert.equal(el.removed, undefined);
  t.mock.timers.tick(1);
  assert.equal(el.removed, true);
});

test('squawk 0032: holding focus pauses the dismiss countdown and focusout resumes with the remaining time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness();
  const controller = await create(h);
  const el = controller.toast('Title', 'Body');

  t.mock.timers.tick(3000); // t=3s into the 5000ms deadline: 2000ms remaining
  el.listeners.get('focusin')();
  t.mock.timers.tick(7000); // t=10s while paused — untouched
  assert.equal(el.removed, undefined);
  el.listeners.get('focusout')(); // resumes with the 2000ms remaining, not a fresh 5000ms
  t.mock.timers.tick(1999);
  assert.equal(el.removed, undefined);
  t.mock.timers.tick(1);
  assert.equal(el.removed, true);
});

test('squawk 0032: both toast auto-dismiss sites route through the shared armDismiss helper', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/media-controller.js'), 'utf8');
  const sites = src.match(/armDismiss\(el, \d+\)/g) || [];
  assert.equal(sites.length, 2, 'expected the bulk-download and single toast() sites to both call armDismiss');
});

// Mission 23 Flight 1 (leg `jar-isolation`): every sink handles a null proxy address by assigning nothing,
// an inline data: image is assigned directly at the two image sinks only, and the docked player keeps the
// token it started with.

test('no token (or a non-web url): thumbnail, poster, inline player, lightbox and docked audio assign nothing', async () => {
  const h = harness();
  const controller = await create(h);
  h.tab.mediaToken = null;
  const image = { type: 'image', url: 'https://x/pic.png', name: 'pic.png' };
  const video = { type: 'video', url: 'https://x/vid.mp4', poster: 'https://x/poster.png', name: 'vid.mp4' };
  const audio = { type: 'audio', url: 'https://x/a.mp3', name: 'a.mp3' };
  h.tab.media = [image, video, audio];
  controller.renderMedia();
  const cards = h.els.mediaList.children;
  assert.ok(!cards[0].children[0].children[1].src, 'thumbnail has no src');
  assert.ok(!String(cards[1].children[0].style.backgroundImage || '').includes('null'), 'no null poster url');
  assert.ok(!String(cards[1].children[0].style.backgroundImage || '').includes('proxy'));
  controller.openLightbox(image);
  assert.ok(!h.els.lightboxStage.children[0].src);
  h.els.playerAudio.src = 'stale';
  controller.playAudio(audio);
  assert.ok(!h.els.playerAudio.src, 'docked audio loads nothing and clears the old address');
});

test('an inline data: image is assigned directly at the thumbnail and the lightbox, never wrapped', async () => {
  const h = harness();
  const controller = await create(h);
  const data = { type: 'image', url: 'data:image/png;base64,AAAA', name: 'image.png' };
  h.tab.media = [data];
  h.tab.mediaToken = null; // not needed for an inline image
  controller.renderMedia();
  assert.equal(h.els.mediaList.children[0].children[0].children[1].src, data.url);
  controller.openLightbox(data);
  assert.equal(h.els.lightboxStage.children[0].src, data.url);
  // ...but the same string on a non-image item is not an inline image.
  const video = { type: 'video', url: 'data:image/png;base64,AAAA', name: 'v' };
  h.tab.media = [video];
  h.tab.mediaToken = 'tok7';
  controller.renderMedia();
  assert.ok(!String(h.els.mediaList.children[0].children[0].style.backgroundImage || '').includes('data:'));
});

test('the docked player uses the token captured when playback began, not the active tab at seek time', async () => {
  const h = harness();
  const controller = await create(h);
  const one = { type: 'audio', url: 'https://x/one.mp3', name: 'One' };
  const two = { type: 'audio', url: 'https://x/two.mp3', name: 'Two' };
  h.tab.media = [one, two];
  controller.playAudio(one);
  h.tab.mediaToken = 'tok-new-document'; // the tab navigated; the player's token is now stale
  controller.playNext();
  assert.equal(h.els.playerAudio.src, `proxy:tok7:${two.url}`);
});
