'use strict';

// Squawk 0146: the browser-import destination modal must not default to Global. Runs the shipped
// controller against a hand-rolled mock DOM (same approach as vault-item-actions-controller.test.js).

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The controller statically imports the FLAT internal-page specifier './vault-page-model.js', which
// only resolves through the internal-page map at runtime. Load the shipped source with that single
// specifier rewritten to the disk path of src/shared/vault-page-model.js (temp copy, otherwise verbatim).
const ROOT = path.join(__dirname, '../..');
let controllerUrlPromise;
const tempDirs = [];
after(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});
function controllerUrl() {
  if (!controllerUrlPromise) {
    controllerUrlPromise = (async () => {
      const src = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/vault-browser-import-controller.js'), 'utf8');
      const modelUrl = pathToFileURL(path.join(ROOT, 'src/shared/vault-page-model.js')).href;
      const rewritten = src.replace(/(['"])\.\/vault-page-model\.js\1/, JSON.stringify(modelUrl));
      assert.notEqual(rewritten, src, 'specifier rewrite must apply');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bimport-'));
      tempDirs.push(dir);
      const file = path.join(dir, 'controller.mjs');
      fs.writeFileSync(file, rewritten);
      const url = pathToFileURL(file).href;
      return url;
    })();
  }
  return controllerUrlPromise;
}

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.className = '';
    this.attributes = new Map();
    this.value = '';
    this.disabled = false;
    this.selected = false;
    this.hidden = false;
    this.textContent = '';
    this._listeners = new Map();
  }
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  setAttribute(n, v) {
    this.attributes.set(n, String(v));
  }
  getAttribute(n) {
    return this.attributes.has(n) ? this.attributes.get(n) : null;
  }
  addEventListener(t, h) {
    if (!this._listeners.has(t)) this._listeners.set(t, []);
    this._listeners.get(t).push(h);
  }
  dispatch(t) {
    for (const h of this._listeners.get(t) || []) h({ type: t, target: this });
  }
}
const el = (tag, className, text) => {
  const n = new El(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};
const appendOption = (select, value, text) => {
  const o = el('option', undefined, text);
  o.value = value;
  select.appendChild(o);
  if (select.children.length === 1) select.value = value;
};
const walk = (n, out = []) => {
  out.push(n);
  n.children.forEach((c) => walk(c, out));
  return out;
};

async function openDest({ candidateCount = 2 } = {}) {
  const { createVaultBrowserImport } = await import(await controllerUrl());
  const modals = [];
  const commits = [];
  const bridge = {
    vaultState: async () => ({ vaults: [{ vaultId: 'global', count: 3 }] }),
    browserImportPick: async () => ({}),
    browserImportSummary: async () => null,
    browserImportCancel: async () => ({}),
    browserImportCommit: async (p) => {
      commits.push(p);
      return { ok: false, reason: 'declined' };
    }
  };
  const openModal = (opts) => {
    const m = { opts, submitEnabled: opts.submitEnabled === true, status: '' };
    m.handle = {
      close() {},
      setSubmitEnabled: (on) => {
        m.submitEnabled = on;
      },
      setStatus: (t) => {
        m.status = t;
      }
    };
    modals.push(m);
    return m.handle;
  };
  const c = createVaultBrowserImport({
    bridge,
    dom: { el, button: () => el('button'), iconButton: () => el('button'), openModal, appendOption },
    getPresence: () => ({
      jarRows: [{ id: 'work', name: 'Work' }],
      jarVaultPresence: { work: { hasVault: true, count: 2 } }
    }),
    refresh: () => {}
  });
  c.openDestinationModal({ handle: 'h1', summary: { candidateCount, skipped: [] } });
  await new Promise((r) => setImmediate(r));
  const m = modals[modals.length - 1];
  const selects = walk(m.opts.body).filter((n) => n.tagName === 'SELECT');
  return { m, dest: selects[0], mode: selects[1], commits };
}
const choose = (dest, v) => {
  dest.value = v;
  dest.dispatch('change');
};
const modeField = (r) => walk(r.m.opts.body).find((n) => n.children.includes(r.mode));

test('destination modal starts on a disabled "Choose a vault…" placeholder (no Global default), Import disabled', async () => {
  const r = await openDest();
  assert.equal(r.dest.value, '');
  assert.deepEqual(
    [
      r.dest.children[0].value,
      r.dest.children[0].textContent,
      r.dest.children[0].disabled,
      r.dest.children[0].selected
    ],
    ['', 'Choose a vault…', true, true]
  );
  assert.ok(r.dest.children.some((o) => o.value === 'global'));
  assert.equal(r.m.opts.submitEnabled, false);
  assert.equal(r.m.submitEnabled, false);
});

test('choosing a destination enables Import; returning to the placeholder disables it; submit on placeholder is a no-op', async () => {
  const r = await openDest();
  choose(r.dest, 'global');
  assert.equal(r.m.submitEnabled, true);
  choose(r.dest, '');
  assert.equal(r.m.submitEnabled, false);
  r.m.opts.onSubmit();
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(r.commits, []);
  choose(r.dest, 'work');
  r.m.opts.onSubmit();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.commits.length, 1);
  assert.equal(r.commits[0].target, 'work');
});

test('Replace/Merge row is hidden on the placeholder and shown only for a non-empty destination', async () => {
  const r = await openDest();
  const field = modeField(r);
  assert.equal(field.hidden, true);
  choose(r.dest, 'work');
  assert.equal(field.hidden, false);
  choose(r.dest, '');
  assert.equal(field.hidden, true);
});

test('zero candidates keeps Import disabled even after choosing a destination', async () => {
  const r = await openDest({ candidateCount: 0 });
  choose(r.dest, 'global');
  assert.equal(r.m.submitEnabled, false);
});
