'use strict';

// Mission 23 Flight 2 (leg `admin-reach`, AC12-AC18): every gated handler, with a REAL reveal gate in its
// three states - not applicable (byte-for-byte today's reply), confirmed, and not confirmed (refusal shape,
// nothing read / written / broadcast). The dialog is a fake that settles on command.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');
const { VaultLockedError } = require('../../src/main/vault/vault-store');
const { makeTestRevealGate } = require('../helpers/reveal-gate-fixture');
const { makeHarness } = require('./helpers/jar-ipc-harness');
const { makeSettingsIpcHarness } = require('./helpers/settings-ipc-harness');

const flush = () => new Promise((r) => setImmediate(r));

/** An internal-page event from tab `id`'s main frame (passes registerInternalHandler AND the gate). */
function internalEvent(rg, id = 7, origin = 'goldfinch://vault') {
  const e = rg.event(id);
  return {
    sender: { ...e.sender, session: { __goldfinchInternal: true } },
    senderFrame: { ...e.senderFrame, origin }
  };
}

// ----------------------------------------------------------------------------- vault

const OTPAUTH = 'otpauth://totp/Bank?secret=JBSWY3DPEHPK3PXP';
function vaultHarness(rg, { locked = false, items } = {}) {
  const calls = [];
  const state = { locked };
  const all = items || [
    { id: 'i1', type: 'login', title: 'Bank', hasTotp: true },
    { id: 'i2', type: 'login', title: 'Mail', hasTotp: false }
  ];
  const store = {
    isUnlocked: () => !state.locked,
    listItemsMeta: (vaultId) => {
      calls.push(['listItemsMeta', vaultId]);
      if (state.locked) throw new VaultLockedError();
      if (state.metaError) throw new Error('projection broke');
      return all;
    },
    revealItem: (vaultId, itemId) => {
      calls.push(['revealItem', vaultId, itemId]);
      if (state.locked) throw new VaultLockedError();
      const m = all.find((x) => x.id === itemId);
      return m ? { ...m, password: 'PW-' + itemId, totp: itemId === 'i1' ? OTPAUTH : '' } : null;
    },
    exportVault: (target) => {
      calls.push(['exportVault', target]);
      if (state.locked) throw new VaultLockedError();
      return { bundle: target };
    },
    exportProfile: () => {
      calls.push(['exportProfile']);
      if (state.locked) throw new VaultLockedError();
      return { bundle: { all: true }, carried: ['Global'] };
    }
  };
  const handlers = new Map();
  const saves = [];
  registerVaultIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    revealGate: rg.gate,
    registerInternalHandler,
    getVaultStore: () => store,
    jars: { list: () => [{ id: 'work', name: 'Work' }] },
    vaultSaveBundle: async (bundle, savePath) => {
      saves.push([bundle, savePath]);
      return { ok: true, path: savePath || '/chosen' };
    }
  });
  return { handlers, calls, state, saves, invoke: (c, ev, ...a) => handlers.get(c)(ev, ...a) };
}

test("AC12: reveal - not applicable is today's reply with no dialog; item absent takes today's path with no dialog", async () => {
  const rg = makeTestRevealGate();
  const h = vaultHarness(rg);
  const r = await h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  assert.equal(r.item.password, 'PW-i1');
  assert.equal(rg.dialogs.length, 0);
  const nope = await h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'zzz' });
  assert.deepEqual(nope, { item: null });
  // malformed payloads keep today's behaviour
  assert.deepEqual(await h.invoke('internal-vault-reveal', internalEvent(rg), undefined), { item: null });
});

test('AC12: reveal with an admin attached asks first; deny -> { refused } and revealItem is NOT called; confirm -> the item', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  const p = h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  await flush();
  assert.equal(rg.dialogs.length, 1);
  assert.match(rg.dialogs[0].options.message, /Bank/);
  assert.ok(!JSON.stringify(rg.dialogs[0].options).includes('PW-i1'), 'a secret never appears in the dialog');
  rg.dialogs[0].answer(0);
  assert.deepEqual(await p, { refused: 'not-confirmed' });
  assert.equal(h.calls.filter((c) => c[0] === 'revealItem').length, 0);

  const p2 = h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  await flush();
  rg.dialogs[1].answer(1);
  const r = await p2;
  assert.equal(r.item.password, 'PW-i1');
  // the same item again - same document: no dialog (AC7), the reveal returns whole as today
  const r2 = await h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  assert.equal(r2.item.password, 'PW-i1');
  assert.equal(rg.dialogs.length, 2);
  // a different item asks
  const p3 = h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i2' });
  await flush();
  assert.equal(rg.dialogs.length, 3);
  rg.dialogs[2].answer(0);
  assert.deepEqual(await p3, { refused: 'not-confirmed' });
});

test('AC12: a locked vault answers { locked: true } BEFORE any dialog; locking while the dialog is up never reveals', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg, { locked: true });
  assert.deepEqual(await h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i1' }), {
    locked: true
  });
  assert.equal(rg.dialogs.length, 0);

  const h2 = vaultHarness(makeTestRevealGate({ admin: true }));
  const rg2 = makeTestRevealGate({ admin: true });
  const h3 = vaultHarness(rg2);
  const p = h3.invoke('internal-vault-reveal', internalEvent(rg2), { vaultId: 'global', itemId: 'i1' });
  await flush();
  h3.state.locked = true; // the operator locks while the dialog is up
  rg2.dialogs[0].answer(1);
  assert.deepEqual(await p, { locked: true });
  void h2;
});

test('a lock-then-unlock while the dialog is up reveals nothing; a lock alone still answers { locked: true } (reveal, code, export, export-profile)', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  const cases = [
    ['internal-vault-reveal', [{ vaultId: 'global', itemId: 'i1' }], { refused: 'not-confirmed' }, 'revealItem'],
    [
      'internal-vault-totp-code',
      [{ vaultId: 'global', itemId: 'i1' }],
      { code: null, refused: 'not-confirmed' },
      'revealItem'
    ],
    ['internal-vault-export', ['global'], { ok: false, canceled: true, refused: 'not-confirmed' }, 'exportVault'],
    ['internal-vault-export-profile', [], { ok: false, canceled: true, refused: 'not-confirmed' }, 'exportProfile']
  ];
  for (const [channel, args, refusal, call] of cases) {
    const before = rg.dialogs.length;
    const reads = h.calls.filter((c) => c[0] === call).length;
    const p = h.invoke(channel, internalEvent(rg), ...args);
    await flush();
    h.state.locked = true;
    rg.marks.clearGrants(); // the vault lock
    h.state.locked = false; // unlocked again, still inside the dialog
    rg.dialogs[before].answer(1);
    assert.deepEqual(await p, refusal, channel);
    assert.equal(h.calls.filter((c) => c[0] === call).length, reads, `${channel}: nothing read`);

    const q = h.invoke(channel, internalEvent(rg), ...args);
    await flush();
    h.state.locked = true;
    rg.marks.clearGrants();
    rg.dialogs[before + 1].answer(1);
    assert.deepEqual(await q, { locked: true }, `${channel}: lock only`);
    h.state.locked = false;
  }
});

test("the reveal gate lookup fails closed: an unreadable metadata projection is a refusal when the gate applies, today's read when it does not", async () => {
  const payload = { vaultId: 'global', itemId: 'i1' };
  for (const channel of ['internal-vault-reveal', 'internal-vault-totp-code']) {
    const rg = makeTestRevealGate({ admin: true });
    const h = vaultHarness(rg);
    h.state.metaError = true;
    const r = await h.invoke(channel, internalEvent(rg), payload);
    assert.equal(r.refused, 'not-confirmed', channel);
    assert.equal(h.calls.filter((c) => c[0] === 'revealItem').length, 0, `${channel}: no ungated read`);
    assert.equal(rg.dialogs.length, 0);
    // a payload that names no item by strings is the same case
    const r2 = await h.invoke(channel, internalEvent(rg), { vaultId: ['global'], itemId: ['i1'] });
    assert.equal(r2.refused, 'not-confirmed', `${channel}: non-string ids`);
    assert.equal(h.calls.filter((c) => c[0] === 'revealItem').length, 0);
  }
  // gate does not apply: the lookup failure changes nothing (today's read, no dialog)
  const idle = makeTestRevealGate();
  const hi = vaultHarness(idle);
  hi.state.metaError = true;
  await hi.invoke('internal-vault-reveal', internalEvent(idle), payload);
  assert.equal(idle.dialogs.length, 0);
  assert.equal(hi.calls.filter((c) => c[0] === 'revealItem').length, 1);
  // a genuinely absent item keeps the no-dialog path even with the gate applying
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  await h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'zzz' });
  assert.equal(rg.dialogs.length, 0);
});

test('AC13: code read - same sequence; refusal is { code: null, refused }; confirmed returns code + remaining, never the seed', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  const p = h.invoke('internal-vault-totp-code', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  await flush();
  assert.match(rg.dialogs[0].options.message, /one-time code/);
  rg.dialogs[0].answer(0);
  assert.deepEqual(await p, { code: null, refused: 'not-confirmed' });
  assert.equal(h.calls.filter((c) => c[0] === 'revealItem').length, 0);

  const p2 = h.invoke('internal-vault-totp-code', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  await flush();
  rg.dialogs[1].answer(1);
  const r = await p2;
  assert.deepEqual(Object.keys(r).sort(), ['code', 'secondsRemaining']);
  assert.ok(!JSON.stringify(r).includes('JBSWY3DPEHPK3PXP'));
  // a reveal confirmed for the item grants its later code reads (and the reverse), per document
  const rg3 = makeTestRevealGate({ admin: true });
  const h3 = vaultHarness(rg3);
  const q = h3.invoke('internal-vault-reveal', internalEvent(rg3), { vaultId: 'global', itemId: 'i1' });
  await flush();
  rg3.dialogs[0].answer(1);
  await q;
  const code = await h3.invoke('internal-vault-totp-code', internalEvent(rg3), { vaultId: 'global', itemId: 'i1' });
  assert.match(code.code, /^\d{6}$/);
  assert.equal(rg3.dialogs.length, 1);
  // an item with no code and not-applicable: today's { code: null }
  const idle = vaultHarness(makeTestRevealGate());
  assert.deepEqual(
    await idle.invoke('internal-vault-totp-code', internalEvent(makeTestRevealGate()), {
      vaultId: 'global',
      itemId: 'i2'
    }),
    { code: null }
  );
});

test('AC15: export and export-profile - confirm BEFORE the bundle is built; refusal keeps the non-success shape; locked first', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  const p = h.invoke('internal-vault-export', internalEvent(rg), 'work', '/home/u/Backups/out.gfvaultbundle');
  await flush();
  assert.equal(h.calls.filter((c) => c[0] === 'exportVault').length, 0, 'not built while the dialog is up');
  assert.match(rg.dialogs[0].options.message, /Work/);
  assert.match(rg.dialogs[0].options.message, /Destination folder: "Backups"/);
  rg.dialogs[0].answer(0);
  assert.deepEqual(await p, { ok: false, canceled: true, refused: 'not-confirmed' });
  assert.equal(h.calls.filter((c) => c[0] === 'exportVault').length, 0);
  assert.equal(h.saves.length, 0);

  const p2 = h.invoke('internal-vault-export', internalEvent(rg), 'work');
  await flush();
  rg.dialogs[1].answer(1);
  assert.deepEqual(await p2, { ok: true, path: '/chosen' });
  assert.equal(h.saves.length, 1);

  const p3 = h.invoke('internal-vault-export-profile', internalEvent(rg));
  await flush();
  assert.match(rg.dialogs[2].options.message, /whole profile/);
  rg.dialogs[2].answer(0);
  assert.deepEqual(await p3, { ok: false, canceled: true, refused: 'not-confirmed' });

  // locked: answered before any dialog
  const lrg = makeTestRevealGate({ admin: true });
  const lh = vaultHarness(lrg, { locked: true });
  assert.deepEqual(await lh.invoke('internal-vault-export', internalEvent(lrg), 'work'), { locked: true });
  assert.deepEqual(await lh.invoke('internal-vault-export-profile', internalEvent(lrg)), { locked: true });
  assert.equal(lrg.dialogs.length, 0);

  // not applicable: today's reply, no dialog
  const nrg = makeTestRevealGate();
  const nh = vaultHarness(nrg);
  assert.deepEqual(await nh.invoke('internal-vault-export', internalEvent(nrg), 'work', '/tmp/x'), {
    ok: true,
    path: '/tmp/x'
  });
  assert.deepEqual(await nh.invoke('internal-vault-export-profile', internalEvent(nrg)), {
    ok: true,
    path: '/chosen',
    carried: ['Global']
  });
  assert.equal(nrg.dialogs.length, 0);
});

test('AC17: a registrar without the gate throws at registration (vault, even with no save delegate)', () => {
  const base = {
    ipcMain: { handle() {} },
    registerInternalHandler,
    getVaultStore: () => ({}),
    jars: { list: () => [] }
  };
  assert.throws(() => registerVaultIpc(base), /revealGate is required/);
  assert.throws(() => registerVaultIpc({ ...base, revealGate: {} }), /revealGate is required/);
  assert.doesNotThrow(() => registerVaultIpc({ ...base, revealGate: makeTestRevealGate().gate }));
  const full = makeTestRevealGate().gate;
  for (const m of ['itemWritten', 'itemCopied', 'itemDeleted', 'dropAllGrants']) {
    assert.throws(() => registerVaultIpc({ ...base, revealGate: { ...full, [m]: undefined } }), new RegExp(m));
  }
});

// ----------------------------------------------------------------------------- cookie value

const COOKIE = {
  name: 'sid',
  domain: 'host.test',
  path: '/',
  secure: false,
  hostOnly: true,
  session: true,
  value: 'v1'
};
const cookieReq = { id: 'personal', name: 'sid', domain: 'host.test', path: '/' };

test('AC14: cookie value - validation and lookup first; deny -> not-confirmed with no value; confirm -> re-fetched value', async (t) => {
  const rg = makeTestRevealGate({ admin: true });
  const jarCookies = { 'persist:container:personal': [COOKIE] };
  const h = makeHarness(t, { cookiesByPartition: jarCookies, revealGate: rg.gate });
  const ev = () => internalEvent(rg, 7, 'goldfinch://jars');
  // malformed / unknown / not-found never raise a dialog
  assert.deepEqual(await h.handlers.get('internal-jars-cookies-value')(ev(), null), {
    ok: false,
    error: 'jars: cookies-value — malformed-payload'
  });
  assert.deepEqual(await h.handlers.get('internal-jars-cookies-value')(ev(), { ...cookieReq, id: 'nope' }), {
    ok: false,
    error: 'jars: cookies-value — unknown-jar'
  });
  assert.deepEqual(await h.handlers.get('internal-jars-cookies-value')(ev(), { ...cookieReq, name: 'zz' }), {
    ok: false,
    error: 'jars: cookies-value — not-found'
  });
  assert.equal(rg.dialogs.length, 0);

  const p = h.handlers.get('internal-jars-cookies-value')(ev(), cookieReq);
  await flush();
  assert.match(rg.dialogs[0].options.message, /sid \(host\.test\)/);
  assert.ok(!JSON.stringify(rg.dialogs[0].options).includes('v1'), 'the value never appears in the dialog');
  rg.dialogs[0].answer(0);
  const refused = await p;
  assert.deepEqual(refused, { ok: false, error: 'jars: cookies-value — not-confirmed' });
  assert.ok(!JSON.stringify(refused).includes('v1'));

  // confirm: the cookie is fetched AGAIN and THAT value returned (it changed while the dialog was up)
  const p2 = h.handlers.get('internal-jars-cookies-value')(ev(), cookieReq);
  await flush();
  COOKIE.value = 'v2';
  rg.dialogs[1].answer(1);
  assert.deepEqual(await p2, { ok: true, value: 'v2' });
  const gets = h.events.filter((e) => e.fn === 'cookiesGet').length;
  assert.ok(gets >= 3, `cookies fetched again after confirmation (saw ${gets})`);
  COOKIE.value = 'v1';

  // gone after the confirmation: not-found, as today
  const p3 = h.handlers.get('internal-jars-cookies-value')(ev(), cookieReq);
  await flush();
  jarCookies['persist:container:personal'].length = 0;
  rg.dialogs[2].answer(1);
  assert.deepEqual(await p3, { ok: false, error: 'jars: cookies-value — not-found' });
});

test("AC14/AC18: cookie value is today's reply when the gate does not apply (no second fetch)", async (t) => {
  const h = makeHarness(t, { cookiesByPartition: { 'persist:container:personal': [COOKIE] } });
  const r = await h.invokeInternal('internal-jars-cookies-value', cookieReq);
  assert.deepEqual(r, { ok: true, value: COOKIE.value });
  assert.equal(h.events.filter((e) => e.fn === 'cookiesGet').length, 1);
});

test('AC17: registerJarIpc without the gate throws at registration', (t) => {
  assert.throws(() => makeHarness(t, { revealGate: null }), /revealGate is required/);
});

// ----------------------------------------------------------------------------- key minting

test('AC16: jar mint and admin mint - gate first; refusal { key: null, refused }, nothing written, nothing broadcast', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = makeSettingsIpcHarness({ revealGate: rg.gate });
  const mint = (channel, ...a) => h.internal.get(channel)(internalEvent(rg, 7, 'goldfinch://automation'), ...a);

  h.events.length = 0;
  const p = mint('automation:jar-key-mint', 'personal');
  await flush();
  assert.match(rg.dialogs[0].options.message, /"Personal"/);
  rg.dialogs[0].answer(0);
  assert.deepEqual(await p, { key: null, refused: 'not-confirmed' });
  assert.deepEqual(h.events, [], 'no write, no settings-changed broadcast');
  assert.deepEqual(h.values.automationKeyHashes, {});

  const pa = mint('automation:admin-key-mint');
  await flush();
  assert.match(rg.dialogs[1].options.message, /admin automation key/);
  rg.dialogs[1].answer(0);
  assert.deepEqual(await pa, { key: null, refused: 'not-confirmed' });
  assert.deepEqual(h.events, []);
  assert.equal(h.values.automationAdminKeyHash, '');

  // confirmed: minted as today, broadcast as today
  const pc = mint('automation:jar-key-mint', 'personal');
  await flush();
  rg.dialogs[2].answer(1);
  assert.deepEqual(await pc, { key: 'jar-key' });
  assert.ok(h.events.some((e) => e[0] === 'broadcast' && e[1] === 'settings-changed'));
  const pad = mint('automation:admin-key-mint');
  await flush();
  rg.dialogs[3].answer(1);
  assert.deepEqual(await pad, { key: 'admin-key' });

  // an unknown jar raises no dialog and goes to the mint as today
  const n = rg.dialogs.length;
  await mint('automation:jar-key-mint', 'ghost');
  assert.equal(rg.dialogs.length, n);
});

test('AC16: the two revokes, the automation toggle and an unrelated settings write are NOT gated with an admin attached', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = makeSettingsIpcHarness({ revealGate: rg.gate });
  const ev = () => internalEvent(rg, 7, 'goldfinch://automation');
  assert.deepEqual(await h.internal.get('automation:jar-key-revoke')(ev(), 'personal'), { ok: true });
  assert.deepEqual(await h.internal.get('automation:admin-key-revoke')(ev()), { ok: true });
  await h.internal.get('internal-settings-set')(ev(), 'automationEnabled', false);
  await h.internal.get('internal-settings-set')(ev(), 'spellcheck', true);
  assert.equal(rg.dialogs.length, 0);
});

test('AC18: with neither condition holding every gated mint answers exactly as before (no dialog)', async () => {
  const rg = makeTestRevealGate();
  const h = makeSettingsIpcHarness({ revealGate: rg.gate });
  assert.deepEqual(await h.invokeInternal('automation:jar-key-mint', 'personal'), { key: 'jar-key' });
  assert.deepEqual(await h.invokeInternal('automation:admin-key-mint'), { key: 'admin-key' });
  assert.equal(rg.dialogs.length, 0);
});

test('AC17: registerSettingsIpc without the gate throws at registration', () => {
  assert.throws(() => makeSettingsIpcHarness({ revealGate: { confirm: 'nope' } }), /revealGate is required/);
});

test('AC3 at the handlers: a subframe sender is refused, not asked, while admin is attached', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = makeSettingsIpcHarness({ revealGate: rg.gate });
  const e = internalEvent(rg, 7, 'goldfinch://automation');
  e.senderFrame = { ...e.senderFrame, frameTreeNodeId: 99 };
  assert.deepEqual(await h.internal.get('automation:admin-key-mint')(e), { key: null, refused: 'not-confirmed' });
  assert.equal(rg.dialogs.length, 0);
});

test('a busy gate (another dialog open for the window) answers { refused, busy: true } on item reads only; a denial stays the bare refusal', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  const first = h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i1' });
  await flush();
  assert.deepEqual(await h.invoke('internal-vault-totp-code', internalEvent(rg), { vaultId: 'global', itemId: 'i1' }), {
    code: null,
    refused: 'not-confirmed',
    busy: true
  });
  assert.deepEqual(await h.invoke('internal-vault-reveal', internalEvent(rg), { vaultId: 'global', itemId: 'i2' }), {
    refused: 'not-confirmed',
    busy: true
  });
  rg.dialogs[0].answer(0);
  assert.deepEqual(await first, { refused: 'not-confirmed' }, 'a denial is not marked busy');
});

test('fix 1: a gone the operator did not cause answers busy: true on item reads; a navigation gone stays bare', async () => {
  // rule 1: background tab
  const bg = makeTestRevealGate({ admin: true, isActive: () => false });
  const hb = vaultHarness(bg);
  const arg = { vaultId: 'global', itemId: 'i1' };
  assert.deepEqual(await hb.invoke('internal-vault-reveal', internalEvent(bg), arg), {
    refused: 'not-confirmed',
    busy: true
  });
  assert.deepEqual(await hb.invoke('internal-vault-totp-code', internalEvent(bg), arg), {
    code: null,
    refused: 'not-confirmed',
    busy: true
  });
  assert.equal(bg.dialogs.length, 0);
  // rule 2: tab left the front
  const rg = makeTestRevealGate({ admin: true });
  const h = vaultHarness(rg);
  const p = h.invoke('internal-vault-reveal', internalEvent(rg), arg);
  await flush();
  rg.gate.tabInactive(7);
  assert.deepEqual(await p, { refused: 'not-confirmed', busy: true });
  // rule 3: input
  const t = { v: 0 };
  const ri = makeTestRevealGate({ admin: true, now: () => t.v });
  const hi = vaultHarness(ri);
  const q = hi.invoke('internal-vault-totp-code', internalEvent(ri), arg);
  await flush();
  t.v += 1000;
  ri.gate.windowInput(ri.windowOf(7));
  assert.deepEqual(await q, { code: null, refused: 'not-confirmed', busy: true });
  // navigation: no busy
  const rn = makeTestRevealGate({ admin: true });
  const hn = vaultHarness(rn);
  const n = hn.invoke('internal-vault-reveal', internalEvent(rn), arg);
  await flush();
  rn.navigate(7);
  assert.deepEqual(await n, { refused: 'not-confirmed' });
});
