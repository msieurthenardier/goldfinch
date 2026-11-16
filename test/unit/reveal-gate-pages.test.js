'use strict';

// Mission 23 Flight 2 (leg `admin-reach`, AC19): the pages that call a gated bridge method handle a REFUSED
// reply as a normal answer. (The vault page's Reveal / Copy / code widget have their own suite,
// vault-secret-reads-controller.test.js.) Each shipped module runs against fake elements.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDocument } = require('./helpers/jars-page-dom');

const PAGES = path.join(__dirname, '../../src/renderer/pages');
const flush = () => new Promise((r) => setImmediate(r));

// ----------------------------------------------------------------------------- automation mint flow

test('mint: a refusal announces on the key-message line, shows NO reveal box, does not refresh; a key reveals AFTER the refresh', async () => {
  const { runKeyMint, MINT_REFUSED_TEXT, classifyMint } = await import(
    pathToFileURL(path.join(PAGES, 'automation-key-flow.js')).href
  );
  const run = async (reply) => {
    const log = [];
    await runKeyMint({
      mint: async () => reply,
      refresh: async () => log.push('refresh'),
      reveal: (k) => log.push(['reveal', k]),
      announce: (t) => log.push(['say', t]),
      showErr: (e) => log.push(['err', String(e && e.message)])
    });
    return log;
  };
  assert.deepEqual(await run({ key: null, refused: 'not-confirmed' }), [['say', MINT_REFUSED_TEXT]]);
  assert.deepEqual(await run({ key: 'abc' }), ['refresh', ['reveal', 'abc']]);
  // a null key with no refusal (the env gate unset): refresh, no reveal box (today's jar flow would open an empty one)
  assert.deepEqual(await run({ key: null }), ['refresh']);
  assert.deepEqual(await run(undefined), ['refresh']);
  assert.deepEqual(await run({ key: '' }), ['refresh']);
  // a rejection goes to showErr as today
  const log = [];
  await runKeyMint({
    mint: async () => {
      throw new Error('boom');
    },
    refresh: async () => {},
    reveal() {},
    announce() {},
    showErr: (e) => log.push(e.message)
  });
  assert.deepEqual(log, ['boom']);
  assert.equal(classifyMint({ key: 'k', refused: 'not-confirmed' }).kind, 'key');
});

test('the automation page routes BOTH mints through runKeyMint (no inline `.then(({ key })` left)', () => {
  const src = fs.readFileSync(path.join(PAGES, 'automation.js'), 'utf8');
  assert.equal((src.match(/runKeyMint\(\{/g) || []).length, 2);
  assert.ok(!/\.then\(\(\{ key \}\)/.test(src));
  assert.ok(/mint: \(\) => bridge\.automationJarKeyMint\(jar\.id\)/.test(src));
  assert.ok(/mint: \(\) => bridge\.automationAdminKeyMint\(\)/.test(src));
});

// ----------------------------------------------------------------------------- jars cookie eyeball

function findAll(root, pred, out = []) {
  if (pred(root)) out.push(root);
  root.children.forEach((c) => findAll(c, pred, out));
  return out;
}

test("cookie eyeball: not-confirmed gets its own message and renders no value; a real failure keeps today's wording", async () => {
  const doc = createDocument();
  globalThis.document = doc;
  const { createCookiesPanel, NOT_CONFIRMED_TEXT } = await import(
    pathToFileURL(path.join(PAGES, 'jars-cookies-panel.js')).href
  );
  const errors = [];
  let reply;
  const bridge = {
    jarsCookiesList: async () => ({
      ok: true,
      cookies: [
        { name: 'sid', domain: 'a.test', path: '/', expirationDate: null, secure: false, hostOnly: true, session: true }
      ]
    }),
    jarsCookiesValue: async () => reply
  };
  const mount = doc.createElement('div');
  const panel = createCookiesPanel({
    bridge,
    jarId: 'personal',
    mountEl: mount,
    onError: (m) => errors.push(m),
    onCountChanged() {}
  });
  panel.refresh();
  await flush();
  const eye = findAll(mount, (n) => n.className === 'jar-datalist-row-reveal')[0];
  assert.ok(eye);

  reply = { ok: false, error: 'jars: cookies-value — not-confirmed' };
  eye.dispatch('click', {});
  await flush();
  assert.deepEqual(errors, [NOT_CONFIRMED_TEXT]);
  assert.equal(findAll(mount, (n) => n.className === 'jar-datalist-row-value').length, 0, 'no value node');
  assert.equal(eye.attributes.get('aria-pressed'), 'false', 'the row is hidden again');

  reply = { ok: false, error: 'jars: cookies-value — not-found' };
  eye.dispatch('click', {});
  await flush();
  assert.equal(errors[1], 'Could not load cookie value');

  reply = { ok: true, value: 'v1' };
  eye.dispatch('click', {});
  await flush();
  assert.equal(findAll(mount, (n) => n.className === 'jar-datalist-row-value')[0].textContent, 'v1');
  delete globalThis.document;
});

// ----------------------------------------------------------------------------- jars delete-first export

function findButton(root, label) {
  return findAll(root, (n) => n.tagName === 'BUTTON' && n.textContent === label)[0] || null;
}

test('delete-first export: a refused export says so, re-enables Export, and NEITHER proceeds to nor blocks the delete', async () => {
  const doc = createDocument();
  doc.body = doc.createElement('body');
  doc.body.ownerDocument = doc;
  globalThis.document = doc;
  const { createConfirmModal } = await import(pathToFileURL(path.join(PAGES, 'jars-confirm-modal.js')).href);
  const ran = [];
  const ui = { mode: 'confirm', rowId: 'work', action: 'delete', vaultPresent: true };
  const modal = createConfirmModal({
    dataActions: {
      delete: {
        copy: 'x',
        run: async (id) => {
          ran.push(id);
          return { ok: true };
        },
        okNote: '',
        failNote: 'no',
        silentSuccess: true,
        vaultPresentCopy: 'vault copy',
        exportVault: async () => ({ ok: false, canceled: true, refused: 'not-confirmed' })
      }
    },
    titles: { delete: 'Delete jar?' },
    getUi: () => ui,
    closeTransient: () => {},
    getSectionRefs: () => ({ dataButtons: new Map() }),
    setSectionStatus: () => {},
    fallbackFocusEl: doc.createElement('button')
  });
  modal.update();
  const backdrop = doc.body.children.find((c) => c.id === 'jars-confirm-backdrop');
  const exportBtn = findButton(backdrop, 'Export vault first');
  exportBtn.dispatch('click', {});
  await flush();
  const texts = findAll(backdrop, () => true).map((n) => n.textContent);
  assert.ok(
    texts.includes('Export not confirmed - nothing was written.'),
    'the refusal is stated (not "Export canceled.")'
  );
  assert.ok(!texts.includes('Export canceled.'));
  assert.equal(exportBtn.disabled, false, 'Export can be tried again');
  assert.deepEqual(ran, [], 'a refused export never runs the delete');
  const confirmBtn = findButton(backdrop, 'Confirm');
  assert.equal(confirmBtn.disabled, false, 'and never blocks the operator from choosing to delete');
  confirmBtn.dispatch('click', {});
  await flush();
  assert.deepEqual(ran, ['work']);
  delete globalThis.document;
});

// ----------------------------------------------------------------------------- vault Export modal

test('vault Export modal: a refused export sets the refusal status BEFORE the canceled branch and re-enables Submit', async () => {
  // The controller imports flat serving-path specifiers; rewrite them to disk files so the SHIPPED text runs.
  const shared = path.join(__dirname, '../../src/shared');
  let src = fs.readFileSync(path.join(PAGES, 'vault-restore-controller.js'), 'utf8');
  src = src
    .replace("'./vault-page-model.js'", JSON.stringify(pathToFileURL(path.join(shared, 'vault-page-model.js')).href))
    .replace("'./safe-color.js'", JSON.stringify(pathToFileURL(path.join(shared, 'safe-color.js')).href))
    .replace("'./jar-page-model.js'", JSON.stringify(pathToFileURL(path.join(shared, 'jar-page-model.js')).href));
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

  const doc = createDocument();
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const status = [];
  const submit = [];
  let submitFn;
  let body;
  const handle = {
    close() {},
    setStatus: (t) => status.push(t),
    setSubmitEnabled: (on) => submit.push(on)
  };
  const dom = {
    el,
    iconButton: () => el('button'),
    appendOption: (sel, value, label) => {
      const o = el('option', undefined, label);
      o.value = value;
      sel.appendChild(o);
    },
    openModal: (opts) => {
      body = opts.body;
      submitFn = opts.onSubmit;
      return handle;
    }
  };
  let reply;
  const bridge = { exportProfile: async () => reply, exportVault: async () => reply, pickSavePath: async () => ({}) };
  const ctl = mod.createVaultRestoreController({
    bridge,
    dom,
    getJarRows: () => [],
    getJarVaultPresence: () => ({}),
    refresh() {},
    setNotice() {}
  });
  globalThis.document = doc;
  ctl.openExportModal([{ vaultId: 'global', label: 'Global' }]);
  const inputs = [];
  const collect = (n) => {
    if (n.className === 'vault-modal-path-input') inputs.push(n);
    n.children.forEach(collect);
  };
  collect(body);
  inputs[0].value = '/tmp/x.gfvaultbundle';
  reply = { ok: false, canceled: true, refused: 'not-confirmed' };
  status.length = 0;
  submit.length = 0;
  submitFn();
  await flush();
  assert.deepEqual(status, ['Exporting…', 'Export not confirmed - nothing was written.']);
  assert.deepEqual(submit, [false, true]);
  delete globalThis.document;
});
