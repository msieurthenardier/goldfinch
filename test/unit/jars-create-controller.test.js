'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Element, createDocument } = require('./helpers/jars-page-dom');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/jars-create-controller.js')).href;

test('create panel stays anchored before Burner and preserves focused draft DOM across broadcasts', async () => {
  const { createJarsCreatePanel } = await import(moduleUrl);
  const document = createDocument();
  const sectionsEl = document.createElement('main');
  const persistentRoot = document.createElement('section');
  const burnerRoot = document.createElement('section');
  sectionsEl.appendChild(persistentRoot);
  sectionsEl.appendChild(burnerRoot);
  const newBtn = document.createElement('button');
  const listeners = new Map();
  const window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); }
  };
  let ui = { mode: 'create', rowId: null, action: null, draft: { name: 'Draft', color: '#111111' } };
  let controller;
  const rows = [
    { id: 'work', isBurner: false },
    { id: '__burner__', isBurner: true }
  ];
  controller = createJarsCreatePanel({
    window,
    document,
    bridge: { jarsAdd: async () => ({ id: 'new' }) },
    sectionsEl,
    newBtn,
    isSafeColor: () => true,
    PALETTE: ['#111111', '#222222'],
    pickNewJarColor: () => '#111111',
    createPanelModeKey: (value) => value.mode === 'create' ? 'create' : null,
    getContainers: () => [{ id: 'work', color: '#111111' }],
    getUi: () => ui,
    setUi: (next) => { ui = next; },
    getSectionRefs: (id) => id === '__burner__' ? { root: burnerRoot } : { root: persistentRoot },
    requestRender: () => controller.render(rows)
  });

  controller.render(rows);
  assert.deepEqual(sectionsEl.children, [persistentRoot, controller.element, burnerRoot]);
  const form = controller.element.firstChild;
  const input = form.firstChild.firstChild;
  assert.equal(document.activeElement, input);
  input.value = 'Draft with caret';
  input.selectionStart = 7;
  controller.render([{ ...rows[0], name: 'Unrelated broadcast' }, rows[1]]);
  assert.equal(controller.element.firstChild, form);
  assert.equal(form.firstChild.firstChild, input);
  assert.equal(input.value, 'Draft with caret');
  assert.equal(input.selectionStart, 7);

  controller.destroy();
  assert.equal(newBtn.listeners.get('click').size, 0);
  assert.equal(listeners.has('keydown'), false);
  assert.ok(controller.element instanceof Element);
});
