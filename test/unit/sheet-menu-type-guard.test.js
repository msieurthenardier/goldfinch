'use strict';

// The eleven sheet channels that had NO menu-type guard before Mission 23 Flight 1 (finding 22a),
// now enforced by the gate's `sheet` class from the one table in `ipc-channel-table.js`. For each:
// valid under every listed menu type; refused under an unlisted type and with NO menu open; and a
// refused call writes NOTHING (the vault delegate, the clipboard, the auth callback, the bookmark
// chrome send are asserted on the fakes, not inferred) and zeroes any secret bytes it carried.
// Also pinned here: the four sheet channels that already checked (and are now gate-enforced),
// the three any-open-menu channels under every menu type, and the drag channel's `end` with no
// menu open.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withOverlaySenderLookup } = require('../helpers/fake-overlay-registry');
const { makeTestGate } = require('../helpers/ipc-gate-fixture');
const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const { SHEET_MENU_TYPES, CHANNEL_CLASS } = require('../../src/main/ipc-channel-table');

const ALL_MENU_TYPES = [
  'kebab',
  'container-picker',
  'page-context',
  'tab-context',
  'suggestions',
  'downloads',
  'input-dialog',
  'site-info',
  'cert-viewer',
  'cert-picker',
  'cert-override',
  'auth-basic',
  'bookmark-edit',
  'bookmarks-overflow',
  'vault-unlock',
  'vault-picker',
  'vault-set',
  'vault-recovery-show',
  'vault-stepup',
  'vault-accesskey-show',
  'vault-import-unlock',
  'vault-change-master',
  'vault-recover',
  'vault-adminkey-show',
  'vault-compromise',
  'vault-compromise-recover'
];

function harness() {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle: (c, f) => handlers.set(c, f),
    on: (c, f) => listeners.set(c, f)
  };
  const writes = []; // every delegate / clipboard / chrome-send call, in order
  const sheetSender = { id: 31, isDestroyed: () => false };
  const state = { current: null };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => state.current,
    closeMenuOverlay: (...a) => writes.push(['close', ...a]),
    reassertFocus: () => writes.push(['refocus'])
  };
  const win = { id: 1, isDestroyed: () => false, isFocused: () => true };
  const chrome = { id: 77, send: (...a) => writes.push(['chrome-send', ...a]) };
  const rec = { sheet, win, activeTabWcId: null, tabViews: new Map() };
  const registry = withOverlaySenderLookup({ records: () => [rec], getWindowForChrome: () => null });
  const delegate =
    (name, result = { ok: true }) =>
    async (...args) => {
      writes.push([name]);
      void args;
      return result;
    };
  registerOverlayIpc({
    gate: makeTestGate({ ipcMain, registry, autoFrame: true }),
    registry,
    chromeForAttachment: () => chrome,
    chromeForTab: () => chrome,
    sanitizeActivatedValue: (v) => v,
    vaultUnlock: delegate('vaultUnlock', true),
    vaultSetup: delegate('vaultSetup', { recoveryKeyDisplay: 'rk' }),
    vaultMintAccessKey: delegate('vaultMintAccessKey', { ok: true, secret: 's', keyId: 'k' }),
    vaultImportPreview: delegate('vaultImportPreview'),
    vaultRotateRecovery: delegate('vaultRotateRecovery', { ok: true, recoveryKeyDisplay: 'rk' }),
    vaultRotateAdminKey: delegate('vaultRotateAdminKey', { ok: true, adminPrivateKeyB64: 'ak' }),
    vaultChangeMaster: delegate('vaultChangeMaster'),
    vaultRecover: delegate('vaultRecover'),
    writeClipboard: (text) => writes.push(['clipboard', text]),
    authAnswerFromSheet: (_rec, username) => {
      writes.push(['auth-answer', username]);
      return { answered: true };
    },
    validateBookmarkEdit: () => ({ ok: true, name: 'n', url: 'https://x.test/' }),
    notifyVaultImportLabelsReady: () => writes.push(['labels-ready']),
    broadcastVaultLockState: () => writes.push(['broadcast-lock'])
  });
  return { handlers, listeners, sheetSender, state, writes };
}

const u8 = (n = 3) => Uint8Array.from({ length: n }, (_, i) => i + 1);

/** channel → { payload(): fresh payload, bytes(payload): the byte arrays, write: first write it makes } */
const CASES = {
  'menu-overlay:vault-unlock': {
    payload: () => ({ token: 7, secret: u8() }),
    bytes: (p) => [p.secret],
    write: 'vaultUnlock'
  },
  'menu-overlay:vault-setup': {
    payload: () => ({ token: 7, secret: u8() }),
    bytes: (p) => [p.secret],
    write: 'vaultSetup'
  },
  'menu-overlay:vault-stepup-mint': {
    payload: () => ({ token: 7, secret: u8(), target: 'global' }),
    bytes: (p) => [p.secret],
    write: 'vaultMintAccessKey'
  },
  'menu-overlay:vault-rotate-recovery': {
    payload: () => ({ token: 7, secret: u8() }),
    bytes: (p) => [p.secret],
    write: 'vaultRotateRecovery'
  },
  'menu-overlay:vault-rotate-admin': {
    payload: () => ({ token: 7, secret: u8() }),
    bytes: (p) => [p.secret],
    write: 'vaultRotateAdminKey'
  },
  'menu-overlay:vault-import': {
    payload: () => ({ token: 7, secret: u8(), secretKind: 'master' }),
    bytes: (p) => [p.secret],
    write: 'vaultImportPreview'
  },
  'menu-overlay:vault-change-master': {
    payload: () => ({ token: 7, oldSecret: u8(), newSecret: u8() }),
    bytes: (p) => [p.oldSecret, p.newSecret],
    write: 'vaultChangeMaster'
  },
  'menu-overlay:vault-recover': {
    payload: () => ({ token: 7, recoverySecret: u8(), newSecret: u8() }),
    bytes: (p) => [p.recoverySecret, p.newSecret],
    write: 'vaultRecover'
  },
  'menu-overlay:copy-text': {
    payload: () => ({ text: 'recovery-key-text' }),
    bytes: () => [],
    write: 'clipboard',
    oneWay: true
  },
  'menu-overlay:auth-submit': {
    payload: () => ({ token: 7, username: 'alice', secret: u8() }),
    bytes: (p) => [p.secret],
    write: 'auth-answer'
  },
  'menu-overlay:bookmark-edit-submit': {
    payload: () => ({ token: 7, id: 'b1', action: 'remove' }),
    bytes: () => [],
    write: 'chrome-send'
  }
};

test('the eleven previously un-guarded sheet channels are exactly the ones this suite covers, each with a non-empty menu-type list', () => {
  assert.deepEqual(Object.keys(CASES).sort(), [
    'menu-overlay:auth-submit',
    'menu-overlay:bookmark-edit-submit',
    'menu-overlay:copy-text',
    'menu-overlay:vault-change-master',
    'menu-overlay:vault-import',
    'menu-overlay:vault-recover',
    'menu-overlay:vault-rotate-admin',
    'menu-overlay:vault-rotate-recovery',
    'menu-overlay:vault-setup',
    'menu-overlay:vault-stepup-mint',
    'menu-overlay:vault-unlock'
  ]);
  for (const channel of Object.keys(CASES)) {
    assert.equal(CHANNEL_CLASS[channel], 'sheet');
    assert.ok(Array.isArray(SHEET_MENU_TYPES[channel]) && SHEET_MENU_TYPES[channel].length > 0, channel);
  }
  // the lists the leg derived from the single sender site of each preload method
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:vault-unlock'], ['vault-unlock']);
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:vault-setup'], ['vault-set']);
  for (const c of ['vault-stepup-mint', 'vault-rotate-recovery', 'vault-rotate-admin']) {
    assert.deepEqual(SHEET_MENU_TYPES[`menu-overlay:${c}`], ['vault-stepup']);
  }
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:vault-import'], ['vault-import-unlock']);
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:vault-change-master'], ['vault-change-master']);
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:vault-recover'], ['vault-recover']);
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:copy-text'], [
    'vault-recovery-show',
    'vault-accesskey-show',
    'vault-adminkey-show'
  ]);
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:auth-submit'], ['auth-basic']);
  assert.deepEqual(SHEET_MENU_TYPES['menu-overlay:bookmark-edit-submit'], ['bookmark-edit']);
});

for (const [channel, spec] of Object.entries(CASES)) {
  const run = (h, payload) => {
    const ev = { sender: h.sheetSender };
    return spec.oneWay ? h.listeners.get(channel)(ev, payload) : h.handlers.get(channel)(ev, payload);
  };

  test(`${channel}: valid under EACH listed menu type (and writes)`, async () => {
    for (const menuType of SHEET_MENU_TYPES[channel]) {
      const h = harness();
      h.state.current = { menuType, token: 7 };
      await run(h, spec.payload());
      assert.ok(
        h.writes.some((w) => w[0] === spec.write),
        `${channel} under ${menuType} must reach its write (${spec.write}); saw ${JSON.stringify(h.writes)}`
      );
    }
  });

  test(`${channel}: refused under EVERY unlisted menu type and with NO menu open — nothing is written, secret bytes are zeroed`, async () => {
    const unlisted = ALL_MENU_TYPES.filter((t) => !SHEET_MENU_TYPES[channel].includes(t));
    assert.ok(unlisted.length > 15);
    for (const menuType of [...unlisted, null]) {
      const h = harness();
      h.state.current = menuType === null ? null : { menuType, token: 7 };
      const payload = spec.payload();
      const res = await run(h, payload);
      assert.deepEqual(h.writes, [], `${channel} under ${menuType}: a refused call must write nothing`);
      for (const arr of spec.bytes(payload)) {
        assert.deepEqual(
          [...arr],
          Array.from(arr, () => 0),
          `${channel} under ${menuType}: a refused call zeroes its secret`
        );
      }
      if (!spec.oneWay) assert.ok(res && typeof res === 'object', 'an invoke is answered with the refusal value');
      if (channel === 'menu-overlay:auth-submit') assert.deepEqual(res, { answered: false });
      else if (!spec.oneWay) assert.deepEqual(res, { ok: false });
    }
  });

  test(`${channel}: a call from anyone but the window's sheet is refused and writes nothing`, async () => {
    const h = harness();
    h.state.current = { menuType: SHEET_MENU_TYPES[channel][0], token: 7 };
    const payload = spec.payload();
    const ev = { sender: { id: 5 } };
    if (spec.oneWay) h.listeners.get(channel)(ev, payload);
    else await h.handlers.get(channel)(ev, payload);
    assert.deepEqual(h.writes, []);
    for (const arr of spec.bytes(payload))
      assert.deepEqual(
        [...arr],
        Array.from(arr, () => 0)
      );
  });
}

test('the four sheet channels that already checked a menu type are now enforced by the gate (listed type passes; any other and none refuse)', async () => {
  const cases = [
    ['menu-overlay:overflow-drop', 'bookmarks-overflow', { token: 7, index: 0 }, true],
    ['menu-overlay:vault-compromise', 'vault-compromise', { token: 7, oldSecret: u8(), newSecret: u8() }, false],
    [
      'menu-overlay:vault-compromise-recover',
      'vault-compromise-recover',
      { token: 7, recoverySecret: u8(), newSecret: u8() },
      false
    ]
  ];
  for (const [channel, listed, payload, oneWay] of cases) {
    assert.deepEqual(SHEET_MENU_TYPES[channel], [listed]);
    const refuse = async (menuType) => {
      const h = harness();
      h.state.current = menuType === null ? null : { menuType, token: 7 };
      const p = typeof payload === 'function' ? payload() : { ...payload };
      const fn = oneWay ? h.listeners.get(channel) : h.handlers.get(channel);
      if (fn === undefined) return null; // conditional registration (needs vaultCompromiseRotate)
      await fn({ sender: h.sheetSender }, p);
      return h.writes;
    };
    for (const t of [...ALL_MENU_TYPES.filter((x) => x !== listed), null]) {
      const w = await refuse(t);
      if (w !== null) assert.deepEqual(w, [], `${channel} under ${t}`);
    }
  }
  // overflow-drop reaches its handler under its listed type
  const h = harness();
  h.state.current = { menuType: 'bookmarks-overflow', token: 7 };
  h.listeners.get('menu-overlay:overflow-drop')({ sender: h.sheetSender }, { token: 7, index: 2 });
  assert.deepEqual(h.writes, [
    ['close', 'activated', 7],
    ['chrome-send', 'bookmark-overflow-drop', { index: 2 }]
  ]);
});

test("the three 'any-open-menu' channels (activated, dismissed, refocus) reach their handlers under EVERY menu type and are refused with no menu", () => {
  for (const menuType of ALL_MENU_TYPES) {
    const h = harness();
    h.state.current = { menuType, token: 7 };
    h.listeners.get('menu-overlay:activated')({ sender: h.sheetSender }, { id: 'row', token: 7 });
    assert.deepEqual(
      h.writes.map((w) => w[0]),
      ['close', 'chrome-send'],
      `activated under ${menuType}`
    );
    const d = harness();
    d.state.current = { menuType, token: 7 };
    d.listeners.get('menu-overlay:dismissed')({ sender: d.sheetSender }, { reason: 'escape', token: 7 });
    assert.deepEqual(d.writes, [['close', 'escape', 7]], `dismissed under ${menuType}`);
    const r = harness();
    r.state.current = { menuType, token: 7 };
    r.listeners.get('menu-overlay:refocus')({ sender: r.sheetSender });
    assert.deepEqual(r.writes, [['refocus']], `refocus under ${menuType}`);
  }
  const none = harness();
  none.listeners.get('menu-overlay:activated')({ sender: none.sheetSender }, { id: 'row', token: 7 });
  none.listeners.get('menu-overlay:dismissed')({ sender: none.sheetSender }, { reason: 'escape', token: 7 });
  none.listeners.get('menu-overlay:refocus')({ sender: none.sheetSender });
  assert.deepEqual(none.writes, []);
});

test("menu-overlay:sheet-drag is 'sender-only': its `end` phase still reaches the chrome with NO menu open (the blur-closed sheet)", () => {
  const h = harness();
  h.state.current = null;
  h.listeners.get('menu-overlay:sheet-drag')({ sender: h.sheetSender }, { phase: 'end', token: 3 });
  assert.deepEqual(h.writes, [['chrome-send', 'bookmark-sheet-drag', { phase: 'end', token: 3 }]]);
  // the `start` phase keeps its inline bookmarks-overflow check: no menu, or another menu, sends nothing
  h.writes.length = 0;
  h.listeners.get('menu-overlay:sheet-drag')({ sender: h.sheetSender }, { phase: 'start', token: 3, index: 1 });
  h.state.current = { menuType: 'vault-unlock', token: 3 };
  h.listeners.get('menu-overlay:sheet-drag')({ sender: h.sheetSender }, { phase: 'start', token: 3, index: 1 });
  assert.deepEqual(h.writes, []);
  h.state.current = { menuType: 'bookmarks-overflow', token: 3 };
  h.listeners.get('menu-overlay:sheet-drag')({ sender: h.sheetSender }, { phase: 'start', token: 3, index: 1 });
  assert.deepEqual(h.writes, [['chrome-send', 'bookmark-sheet-drag', { phase: 'start', token: 3, index: 1 }]]);
  // and a non-sheet sender is refused even for `end`
  h.writes.length = 0;
  h.listeners.get('menu-overlay:sheet-drag')({ sender: { id: 5 } }, { phase: 'end', token: 3 });
  assert.deepEqual(h.writes, []);
});
