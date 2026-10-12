'use strict';

// Unit tests for src/renderer/pages/vault-item-actions-controller.js (Sortie 04 / leg 2): the
// delete + revoke confirms (moved verbatim from vault.js) and the two-step Copy-to flow. Runs the
// shipped controller against a hand-rolled mock DOM (no jsdom in this repo); the copy strings are
// asserted against the controller's own frozen COPY_TEXT table.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '../..');
const CONTROLLER_PATH = path.join(ROOT, 'src/renderer/pages/vault-item-actions-controller.js');
const controllerUrl = pathToFileURL(CONTROLLER_PATH).href;
const pageModelUrl = pathToFileURL(path.join(ROOT, 'src/shared/vault-page-model.js')).href;

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.attributes = new Map();
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this._text = '';
    this._listeners = new Map();
    this.focusCalls = 0;
    this.attached = true;
  }
  get isConnected() {
    return this.attached;
  }
  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = String(v);
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  setAttribute(n, v) {
    this.attributes.set(n, String(v));
  }
  getAttribute(n) {
    return this.attributes.has(n) ? this.attributes.get(n) : null;
  }
  addEventListener(type, h) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(h);
  }
  dispatch(type) {
    for (const h of this._listeners.get(type) || []) h({ type, target: this });
  }
  focus() {
    this.focusCalls++;
  }
}

const doc = {
  createElement: (tag) => new El(tag),
  createTextNode: (text) => {
    const n = new El('#text');
    n._text = text;
    return n;
  }
};
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

/** Depth-first walk collecting every node. */
function walk(node, out = []) {
  out.push(node);
  for (const c of node.children) walk(c, out);
  return out;
}
const allText = (node) =>
  walk(node)
    .map((n) => n.textContent)
    .join('|');
const find = (node, pred) => walk(node).filter(pred);

const JARS = [{ id: 'work', name: 'Work' }];
const PRESENCE = { work: { hasVault: true, count: 2 } };

async function harness({ replies = [], vaultState, epoch = { n: 0 }, jars = JARS, presence = PRESENCE } = {}) {
  const { createItemActionsController, COPY_TEXT } = await import(controllerUrl);
  const { copyDestinationOptions } = await import(pageModelUrl);
  const log = [];
  const modals = [];
  const calls = { copy: [], del: [], revoke: [] };
  const queue = [...replies];
  const bridge = {
    vaultItemDelete: async (a) => {
      calls.del.push(a);
      const r = h.deleteImpl();
      return r;
    },
    vaultAccessKeyRevoke: async (a) => {
      calls.revoke.push(a);
      return h.revokeImpl();
    },
    vaultItemCopy: async (a) => {
      calls.copy.push(a);
      const r = queue.shift();
      if (r instanceof Error) throw r;
      return r;
    },
    vaultState: vaultState || (async () => ({ vaults: [{ vaultId: 'global', count: 3 }] }))
  };
  const openModal = (opts) => {
    const m = {
      opts,
      status: '',
      submitEnabled: opts.submitEnabled === true,
      closed: false,
      handle: null
    };
    m.handle = {
      close: () => {
        m.closed = true;
        log.push('close');
      },
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
  const controller = createItemActionsController({
    document: doc,
    bridge,
    dom: { el, iconButton: () => el('button'), openModal, appendOption },
    copyDestinationOptions,
    getJarRows: () => jars,
    getJarVaultPresence: () => presence,
    getRenderEpoch: () => epoch.n,
    refresh: () => log.push('refresh'),
    setNotice: (t) => log.push(`notice:${t}`)
  });
  const h = {
    controller,
    COPY_TEXT,
    log,
    modals,
    calls,
    epoch,
    deleteImpl: async () => ({}),
    revokeImpl: async () => ({ revoked: true }),
    last: () => modals[modals.length - 1],
    flush: async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    }
  };
  return h;
}

const META = { id: 'item-1', type: 'login', title: 'Bank' };

async function openStep1(h, { vaultId = 'global', meta = META, invoker } = {}) {
  h.controller.openCopyTo({ vaultId, meta, invoker });
  await h.flush();
  return h.last();
}
const select1 = (m) => find(m.opts.body, (n) => n.tagName === 'SELECT')[0];

// ── delete / revoke confirm parity ───────────────────────────────────────────

test('openDeleteConfirm: same title, message text nodes, danger submit; submit → vaultItemDelete → close + refresh', async () => {
  const h = await harness();
  h.controller.openDeleteConfirm({ vaultId: 'global', itemId: 'i1', title: 'Bank' });
  const m = h.last();
  assert.equal(m.opts.title, 'Delete item');
  assert.equal(m.opts.submitLabel, 'Delete');
  assert.equal(m.opts.danger, true);
  assert.equal(m.opts.submitEnabled, true);
  const msg = m.opts.body.children[0];
  assert.deepEqual(
    msg.children.map((c) => c.textContent),
    ['Permanently delete ', 'Bank', '? This can’t be undone.']
  );
  assert.equal(msg.children[1].tagName, 'STRONG');
  m.opts.onSubmit();
  assert.equal(m.submitEnabled, false);
  await h.flush();
  assert.deepEqual(h.calls.del, [{ vaultId: 'global', itemId: 'i1' }]);
  assert.deepEqual(h.log, ['close', 'refresh']);
});

test('openDeleteConfirm: {locked} reply → close + refresh; rejection → status text, submit re-enabled', async () => {
  const h = await harness();
  h.deleteImpl = async () => ({ locked: true });
  h.controller.openDeleteConfirm({ vaultId: 'global', itemId: 'i1', title: 'Bank' });
  h.last().opts.onSubmit();
  await h.flush();
  assert.deepEqual(h.log, ['close', 'refresh']);

  const h2 = await harness();
  h2.deleteImpl = async () => {
    throw new Error('x');
  };
  h2.controller.openDeleteConfirm({ vaultId: 'global', itemId: 'i1', title: 'Bank' });
  const m = h2.last();
  m.opts.onSubmit();
  await h2.flush();
  assert.equal(m.status, 'Could not delete the item.');
  assert.equal(m.submitEnabled, true);
  assert.deepEqual(h2.log, []);
});

test('openRevokeConfirm: success → close + refreshKeys (not refresh); {locked} → close + refresh; rejection → status', async () => {
  const h = await harness();
  let keys = 0;
  h.controller.openRevokeConfirm({ vaultId: 'v', keyId: 'k1', refreshKeys: () => keys++ });
  const m = h.last();
  assert.equal(m.opts.title, 'Revoke access key');
  assert.equal(m.opts.submitLabel, 'Revoke');
  assert.deepEqual(
    m.opts.body.children[0].children.map((c) => c.textContent),
    ['Revoke access key ', 'k1', '? Any automation using it will stop working.']
  );
  m.opts.onSubmit();
  await h.flush();
  assert.deepEqual(h.calls.revoke, [{ vaultId: 'v', keyId: 'k1' }]);
  assert.equal(keys, 1);
  assert.deepEqual(h.log, ['close']);

  h.revokeImpl = async () => ({ locked: true });
  h.controller.openRevokeConfirm({ vaultId: 'v', keyId: 'k1', refreshKeys: () => keys++ });
  h.last().opts.onSubmit();
  await h.flush();
  assert.equal(keys, 1);
  assert.deepEqual(h.log, ['close', 'close', 'refresh']);

  h.revokeImpl = async () => {
    throw new Error('x');
  };
  h.controller.openRevokeConfirm({ vaultId: 'v', keyId: 'k1', refreshKeys: () => keys++ });
  const m3 = h.last();
  m3.opts.onSubmit();
  await h.flush();
  assert.equal(m3.status, 'Could not revoke the access key.');
  assert.equal(m3.submitEnabled, true);
});

// ── step 1 ───────────────────────────────────────────────────────────────────

test('step 1: title, labelled select excludes the source vault, first option selected, submit "Copy"', async () => {
  const h = await harness();
  const m = await openStep1(h);
  assert.equal(m.opts.title, h.COPY_TEXT.step1Title('Bank'));
  assert.equal(m.opts.submitLabel, h.COPY_TEXT.submitStep1);
  assert.equal(m.opts.submitEnabled, true);
  const sel = select1(m);
  assert.equal(sel.getAttribute('aria-label'), h.COPY_TEXT.destAria);
  assert.deepEqual(
    sel.children.map((o) => [o.value, o.textContent]),
    [['work', 'Work — 2 secrets']]
  );
  assert.equal(sel.value, 'work');

  const h2 = await harness();
  const m2 = await openStep1(h2, { vaultId: 'work' });
  assert.deepEqual(
    select1(m2).children.map((o) => [o.value, o.textContent]),
    [['global', 'Global — 3 secrets']]
  );
});

test('step 1: a null title renders "(untitled)"; the title is set through textContent only', async () => {
  const h = await harness();
  const m = await openStep1(h, { meta: { id: 'i', type: 'note', title: null } });
  assert.equal(m.opts.title, h.COPY_TEXT.step1Title('(untitled)'));
});

test('step 1: zero destinations → explanatory text and a disabled submit, no select', async () => {
  const h = await harness({ jars: [] });
  const m = await openStep1(h);
  assert.equal(m.opts.submitEnabled, false);
  assert.equal(select1(m), undefined);
  assert.ok(allText(m.opts.body).includes(h.COPY_TEXT.noDestination));
  m.opts.onSubmit();
  await h.flush();
  assert.equal(h.calls.copy.length, 0);
});

test('step 1: a failing vaultState read degrades global presence to "no secrets yet"', async () => {
  const h = await harness({
    vaultState: async () => {
      throw new Error('x');
    }
  });
  const m = await openStep1(h, { vaultId: 'work' });
  assert.equal(select1(m).children[0].textContent, 'Global — no secrets yet');
});

test('step 1 submit sends ids only and disables submit until the reply lands', async () => {
  const h = await harness({ replies: [{ ok: true, outcome: 'copied' }] });
  const m = await openStep1(h);
  m.opts.onSubmit();
  assert.equal(m.submitEnabled, false);
  await h.flush();
  assert.deepEqual(h.calls.copy, [{ sourceVaultId: 'global', itemId: 'item-1', destVaultId: 'work' }]);
});

// ── terminal outcomes ────────────────────────────────────────────────────────

test('terminal outcomes: close, then notice, then refresh — with the exact texts', async () => {
  const T = (await harness()).COPY_TEXT;
  const cases = [
    [{ ok: true, outcome: 'copied' }, T.copied('Work')],
    [{ ok: true, outcome: 'kept-both', title: 'Bank (copy)' }, T.keptBoth('Work', 'Bank (copy)')],
    [{ ok: true, outcome: 'skipped' }, T.skipped],
    [{ ok: true, outcome: 'already-present' }, T.alreadyPresent('Work')]
  ];
  for (const [reply, text] of cases) {
    const h = await harness({ replies: [reply] });
    const m = await openStep1(h);
    m.opts.onSubmit();
    await h.flush();
    assert.deepEqual(h.log, ['close', `notice:${text}`, 'refresh'], reply.outcome);
  }
  assert.equal(T.copied('Work'), 'Copied to Work.');
  assert.equal(T.keptBoth('Work', 'B'), 'Copied to Work as “B”.');
  assert.equal(T.skipped, 'Skipped — nothing copied.');
  assert.equal(T.alreadyPresent('Work'), 'Already in Work — nothing copied.');
});

// ── step 2 ───────────────────────────────────────────────────────────────────

const MATCH = { id: 'm1', type: 'login', title: 'Bank', username: 'ann' };

async function toStep2(h, { invoker } = {}) {
  const m1 = await openStep1(h, { invoker });
  m1.opts.onSubmit();
  await h.flush();
  return h.last();
}
const radios = (m) => find(m.opts.body, (n) => n.tagName === 'INPUT' && n.type === 'radio');

test('step 2 (one match): title, message, 3 radios skip/replace/keep-both, Skip checked', async () => {
  const h = await harness({
    replies: [{ ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip', 'replace', 'keep-both'] }]
  });
  const m = await toStep2(h);
  assert.equal(h.modals.length, 2);
  assert.equal(m.opts.title, h.COPY_TEXT.step2Title('Work'));
  assert.ok(allText(m.opts.body).includes(h.COPY_TEXT.step2Message('Bank', 'ann')));
  const rs = radios(m);
  assert.deepEqual(
    rs.map((r) => [r.value, r.checked, r.name]),
    [
      ['skip', true, 'vault-copy-resolution'],
      ['replace', false, 'vault-copy-resolution'],
      ['keep-both', false, 'vault-copy-resolution']
    ]
  );
  const fieldset = find(m.opts.body, (n) => n.tagName === 'FIELDSET')[0];
  assert.equal(fieldset.className, 'vault-copy-choice');
  assert.equal(fieldset.children[0].tagName, 'LEGEND');
  const text = allText(m.opts.body);
  assert.ok(text.includes(h.COPY_TEXT.choiceReplace));
  assert.match(h.COPY_TEXT.choiceReplace, /overwritten/);
});

test('step 2 (several matches): only skip + keep-both; no Replace radio', async () => {
  const h = await harness({
    replies: [{ ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip', 'keep-both'] }]
  });
  const m = await toStep2(h);
  assert.deepEqual(
    radios(m).map((r) => [r.value, r.checked]),
    [
      ['skip', true],
      ['keep-both', false]
    ]
  );
});

test('step 2 (identity): a single pre-selected Replace option with identity copy', async () => {
  const match = { id: 'p1', type: 'identity', title: 'Me' };
  const h = await harness({ replies: [{ ok: true, outcome: 'needs-resolution', match, allowed: ['replace'] }] });
  const m = await toStep2(h);
  const rs = radios(m);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].value, 'replace');
  assert.equal(rs[0].checked, true);
  const text = allText(m.opts.body);
  assert.ok(text.includes(h.COPY_TEXT.choiceReplaceIdentity));
  assert.equal(h.COPY_TEXT.choiceReplaceIdentity, 'Replace the existing identity profile');
  assert.equal(m.opts.submitLabel, h.COPY_TEXT.submitStep2Identity);
});

test('step 2 (null match title): renders "(untitled)"', async () => {
  const h = await harness({
    replies: [
      { ok: true, outcome: 'needs-resolution', match: { id: 'm', type: 'note', title: null }, allowed: ['skip'] }
    ]
  });
  const m = await toStep2(h);
  assert.ok(allText(m.opts.body).includes('(untitled)'));
});

test('step 2 commit: the checked radio is read at submit time; payload carries matchId; replaced notice names the match', async () => {
  const h = await harness({
    replies: [
      { ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip', 'replace', 'keep-both'] },
      { ok: true, outcome: 'replaced' }
    ]
  });
  const m = await toStep2(h);
  const rs = radios(m);
  rs[0].checked = false;
  rs[1].checked = true; // changed AFTER render — must be read at submit
  m.opts.onSubmit();
  assert.equal(m.submitEnabled, false);
  await h.flush();
  assert.deepEqual(h.calls.copy[1], {
    sourceVaultId: 'global',
    itemId: 'item-1',
    destVaultId: 'work',
    resolution: 'replace',
    matchId: 'm1'
  });
  assert.deepEqual(h.log, ['close', `notice:${h.COPY_TEXT.replaced('Work', 'Bank')}`, 'refresh']);
  assert.equal(h.COPY_TEXT.replaced('Work', 'Bank'), 'Replaced “Bank” in Work.');
});

test('step 2 commit: a needs-resolution reply re-renders step 2 from the NEW match/allowed with the stale status', async () => {
  const h = await harness({
    replies: [
      { ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip', 'replace', 'keep-both'] },
      {
        ok: true,
        outcome: 'needs-resolution',
        match: { ...MATCH, id: 'm2', title: 'Bank2' },
        allowed: ['skip', 'keep-both']
      },
      { ok: true, outcome: 'kept-both', title: 'Bank2 (copy)' }
    ]
  });
  const m = await toStep2(h);
  m.opts.onSubmit();
  await h.flush();
  assert.equal(h.modals.length, 3);
  const m3 = h.last();
  assert.equal(m3.status, h.COPY_TEXT.stale);
  assert.equal(h.COPY_TEXT.stale, 'This vault changed since you chose — please choose again.');
  assert.deepEqual(
    radios(m3).map((r) => r.value),
    ['skip', 'keep-both']
  );
  assert.ok(allText(m3.opts.body).includes('Bank2'));
  radios(m3)[0].checked = false;
  radios(m3)[1].checked = true;
  m3.opts.onSubmit();
  await h.flush();
  assert.equal(h.calls.copy[2].matchId, 'm2');
  assert.equal(h.calls.copy[2].resolution, 'keep-both');
  assert.ok(h.log.includes(`notice:${h.COPY_TEXT.keptBoth('Work', 'Bank2 (copy)')}`));
});

// ── errors and locked ────────────────────────────────────────────────────────

test('errors keep the modal open with the reason text and re-enable submit', async () => {
  const T = (await harness()).COPY_TEXT;
  const cases = [
    [{ ok: false, reason: 'busy' }, T.busy],
    [{ ok: false, reason: 'state' }, T.state],
    [{ ok: false, reason: 'failed' }, T.failed],
    [{ ok: false }, T.failed],
    [new Error('boom'), T.failed]
  ];
  for (const [reply, text] of cases) {
    const h = await harness({ replies: [reply] });
    const m = await openStep1(h);
    m.opts.onSubmit();
    await h.flush();
    assert.equal(m.status, text);
    assert.equal(m.submitEnabled, true);
    assert.equal(m.closed, false);
    assert.deepEqual(h.log, []);
  }
  assert.equal(T.busy, 'A vault rotation is in progress — try again when it finishes.');
  assert.equal(T.state, 'This item could not be copied to that vault.');
  assert.equal(T.failed, 'Copy failed.');
});

test('{locked} → close + refresh with no notice', async () => {
  const h = await harness({ replies: [{ locked: true }] });
  const m = await openStep1(h);
  m.opts.onSubmit();
  await h.flush();
  assert.deepEqual(h.log, ['close', 'refresh']);
});

// ── render epoch ─────────────────────────────────────────────────────────────

test('render epoch: moved between invoke and resolve → only a WRITTEN outcome surfaces (notice + refresh); nothing opens a modal or sets status', async () => {
  const T = (await harness()).COPY_TEXT;
  const cases = [
    [{ ok: true, outcome: 'copied' }, [`notice:${T.copied('Work')}`, 'refresh']],
    [{ ok: true, outcome: 'kept-both', title: 'T' }, [`notice:${T.keptBoth('Work', 'T')}`, 'refresh']],
    [{ ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip'] }, []],
    [{ ok: true, outcome: 'skipped' }, []],
    [{ ok: true, outcome: 'already-present' }, []],
    [{ locked: true }, []],
    [{ ok: false, reason: 'busy' }, []]
  ];
  for (const [reply, expected] of cases) {
    const epoch = { n: 0 };
    const h = await harness({ replies: [reply], epoch });
    const m = await openStep1(h);
    m.opts.onSubmit();
    epoch.n++; // a render() landed while the invoke was in flight
    await h.flush();
    assert.deepEqual(h.log, expected, JSON.stringify(reply));
    assert.equal(h.modals.length, 1, 'no new modal');
    assert.equal(m.status, '', 'no status');
  }
});

test('render epoch: step 2 captures its own epoch at open — an unmoved epoch closes normally, a moved one only surfaces the notice', async () => {
  const two = (epoch) =>
    harness({
      epoch,
      replies: [
        { ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip', 'replace', 'keep-both'] },
        { ok: true, outcome: 'copied' }
      ]
    });
  const e1 = { n: 4 };
  const h1 = await two(e1);
  const m1 = await toStep2(h1);
  m1.opts.onSubmit();
  await h1.flush();
  assert.deepEqual(h1.log, ['close', `notice:${h1.COPY_TEXT.copied('Work')}`, 'refresh']);

  const e2 = { n: 4 };
  const h2 = await two(e2);
  const m2 = await toStep2(h2);
  m2.opts.onSubmit();
  e2.n++;
  await h2.flush();
  assert.deepEqual(h2.log, [`notice:${h2.COPY_TEXT.copied('Work')}`, 'refresh']);
});

// ── focus ────────────────────────────────────────────────────────────────────

test('focus: the invoker is re-focused before step 2 opens when connected, not when detached', async () => {
  const reply = { ok: true, outcome: 'needs-resolution', match: MATCH, allowed: ['skip'] };
  const connected = el('button');
  const h = await harness({ replies: [reply] });
  await toStep2(h, { invoker: connected });
  assert.equal(connected.focusCalls, 1);

  const detached = el('button');
  detached.attached = false;
  const h2 = await harness({ replies: [reply] });
  await toStep2(h2, { invoker: detached });
  assert.equal(detached.focusCalls, 0);
});

// ── hostile reply ────────────────────────────────────────────────────────────

test('a hostile reply field (extra password/notes keys) never reaches any element text', async () => {
  const SECRET = 'cq9marker-hostile-secret';
  const h = await harness({
    replies: [
      {
        ok: true,
        outcome: 'needs-resolution',
        match: { ...MATCH, password: SECRET, notes: SECRET, totp: SECRET },
        allowed: ['skip', 'replace'],
        password: SECRET,
        title: SECRET
      }
    ]
  });
  const m = await toStep2(h);
  for (const modal of h.modals) {
    assert.ok(!allText(modal.opts.body).includes(SECRET));
    assert.ok(!modal.opts.title.includes(SECRET));
  }
  assert.ok(m);
});

// ── source scans ─────────────────────────────────────────────────────────────

const SRC = fs.readFileSync(CONTROLLER_PATH, 'utf8');
const VAULT_JS = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/vault.js'), 'utf8');

test('controller source: no HTML sinks, one vaultItemCopy call site, no src/shared static import', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(SRC), 'textContent only');
  assert.equal([...SRC.matchAll(/bridge\.vaultItemCopy\(/g)].length, 1, 'single shared submit path');
  assert.ok(!/^\s*import\b/m.test(SRC), 'no static import at all');
  assert.ok(!/shared\//.test(SRC.replace(/\/\/.*$/gm, '')), 'no src/shared reference in code');
});

test('vault.js source: row actions are Edit, Copy to, Delete in order; old modals gone; epoch bumped first in render()', () => {
  const block = VAULT_JS.slice(VAULT_JS.indexOf("const actions = el('div', 'vault-item-actions');"));
  const edit = block.indexOf("iconButton('edit'");
  const copy = block.indexOf("iconButton('copy-to', `Copy ${meta.title || 'item'} to another vault`");
  const del = block.indexOf("'trash'");
  assert.ok(edit !== -1 && copy > edit && del > copy, 'Edit < Copy-to < Delete');
  const unknownFn = VAULT_JS.indexOf('function renderUnknownItems');
  assert.ok(unknownFn !== -1);
  const unknownBody = VAULT_JS.slice(unknownFn, VAULT_JS.indexOf('\n  /**', unknownFn));
  assert.ok(!unknownBody.includes('copy-to'), 'renderUnknownItems rows get no Copy-to');
  const hits = VAULT_JS.split('\n').filter((l) => /openDeleteConfirm|openRevokeConfirm/.test(l));
  assert.ok(
    hits.length === 2 && hits.every((l) => /itemActions\.open(Delete|Revoke)Confirm\(/.test(l)),
    hits.join('\n')
  );
  assert.match(VAULT_JS, /function render\(state\) \{\s*renderEpoch\+\+;/);
  assert.match(VAULT_JS, /getRenderEpoch: \(\) => renderEpoch/);
});
