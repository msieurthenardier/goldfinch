'use strict';

const { EventEmitter } = require('node:events');
const { createWindowFactory } = require('../../../src/main/window-factory');

function createHarness(options = {}) {
  const log = [];
  const windowOptions = [];
  const viewOptions = [];
  const chromeSends = [];
  let nextWindowId = 40;
  let nextWebContentsId = 400;

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.id = nextWebContentsId++;
      this.destroyed = false;
      this.focused = false;
      this.loadedFiles = [];
    }

    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; log.push(`destroy-wc:${this.id}`); }
    focus() { this.focused = true; log.push(`focus-wc:${this.id}`); }
    send(channel, payload) {
      chromeSends.push([channel, payload]);
      log.push(`send:${channel}`);
    }
    loadFile(file) { this.loadedFiles.push(file); return Promise.resolve(); }
  }

  class FakeWebContentsView {
    constructor(opts) {
      this.opts = opts;
      this.webContents = new FakeWebContents();
      this.bounds = null;
      this.backgroundColor = null;
      viewOptions.push(opts);
    }

    setBounds(bounds) { this.bounds = { ...bounds }; log.push(`bounds:${bounds.width}x${bounds.height}`); }
    getBounds() { return this.bounds; }
    setBackgroundColor(color) { this.backgroundColor = color; }
  }

  class FakeBaseWindow extends EventEmitter {
    constructor(opts) {
      super();
      this._id = nextWindowId++;
      this.opts = opts;
      this.destroyed = false;
      this.contentSize = null;
      this.contentBounds = { width: opts.width, height: opts.height };
      this.children = [];
      this.contentView = {
        addChildView: (view) => { this.children.push(view); log.push(`add-view:${view.webContents.id}`); },
        removeChildView: (view) => { this.children = this.children.filter((v) => v !== view); log.push(`remove-view:${view.webContents.id}`); }
      };
      windowOptions.push(opts);
    }

    get id() {
      if (this.destroyed && options.throwOnDestroyedRead) throw new Error('Object has been destroyed');
      return this._id;
    }
    isDestroyed() { return this.destroyed; }
    setContentSize(width, height) { this.contentSize = { width, height }; this.contentBounds = { width, height }; }
    getContentBounds() {
      if (this.destroyed && options.throwOnDestroyedRead) throw new Error('Object has been destroyed');
      return { ...this.contentBounds };
    }
    focus() { this.emit('focus'); }
  }

  const records = new Map();
  const registry = {
    create({ win, chromeView, noBootTab }) {
      const record = {
        win,
        chromeView,
        noBootTab,
        tabViews: new Map(),
        activeTabWcId: null,
        findOverlay: null,
        sheet: null,
        tearoffOverlay: null
      };
      records.set(win.id, record);
      log.push(`registry-create:${win.id}`);
      return record;
    },
    get(id) { return records.get(id) || null; },
    remove(id) { records.delete(id); log.push(`registry-remove:${id}`); },
    records() { return [...records.values()]; },
    noteFocus(id) { log.push(`focus:${id}`); }
  };

  const managerDeps = {};
  const managers = {};
  function manager(kind, deps) {
    managerDeps[kind] = deps;
    const instance = kind === 'sheet'
      ? {
          closeMenuOverlay(reason) { log.push(`sheet-close:${reason}`); },
          teardown() { log.push('sheet-teardown'); }
        }
      : kind === 'find'
        ? {
            hide() {}, show() {}, getSessionTabWcId() { return null; },
            teardown() { log.push('find-teardown'); }
          }
        : { teardown() { log.push('tearoff-teardown'); } };
    managers[kind] = instance;
    return instance;
  }

  const jars = options.jars || { list: () => [{ id: 'default' }] };
  const settings = options.settings || { get: () => false };
  const sessionStore = options.sessionStore || { write: () => { log.push('snapshot-write'); } };
  const closedTabStack = { push: () => { log.push('stack-push'); } };

  const factory = createWindowFactory({
    BaseWindow: FakeBaseWindow,
    WebContentsView: FakeWebContentsView,
    platform: options.platform || 'linux',
    argv: options.argv || [],
    isPackaged: options.isPackaged || false,
    paths: {
      icon: '/app/build/icon.png',
      chromePreload: '/app/preload/chrome-preload.js',
      chromeHtml: '/app/renderer/index.html',
      findPreload: '/app/preload/find-overlay-preload.js',
      findHtml: '/app/renderer/find-overlay.html',
      menuPreload: '/app/preload/menu-overlay-preload.js',
      menuHtml: '/app/renderer/menu-overlay.html',
      tearoffHtml: '/app/renderer/tearoff-overlay.html'
    },
    registry,
    isAutomationEnabled: options.isAutomationEnabled || (() => false),
    broadcastMoveTargetsChanged: () => { log.push('broadcast-move-targets'); },
    createFindOverlayManager: (deps) => manager('find', deps),
    createMenuOverlayManager: (deps) => manager('sheet', deps),
    createTearoffOverlayManager: (deps) => manager('tearoff', deps),
    computeFindOverlayBounds: () => null,
    getTabContents: (wcId) => options.tabContents?.get(wcId) || null,
    chromeForAttachment: () => null,
    sheetAcceleratorAction: () => null,
    isInternalContents: () => false,
    isGuestActionAllowed: () => true,
    toggleDevTools: () => {},
    applyZoom: () => {},
    captureWindowCloseEntries: options.captureWindowCloseEntries || (() => { log.push('capture-tabs'); return []; }),
    jars,
    closedTabStack,
    broadcastClosedTabStackChanged: () => { log.push('broadcast-stack'); },
    settings,
    isSessionQuitting: options.isSessionQuitting || (() => false),
    sessionStore,
    buildSessionSnapshot: options.buildSessionSnapshot || (() => { log.push('build-snapshot'); return { version: 1 }; }),
    getHistoryRecorder: options.getHistoryRecorder || (() => ({ forgetTab: (wcId) => { log.push(`forget:${wcId}`); } })),
    defer: options.defer || ((fn) => fn()),
    logger: { warn() {}, error(message) { log.push(`error:${message}`); } }
  });

  return {
    factory,
    log,
    windowOptions,
    viewOptions,
    chromeSends,
    records,
    registry,
    managers,
    managerDeps,
    FakeWebContentsView
  };
}

module.exports = { createHarness };
