'use strict';

// Mission 23 Flight 2, leg `admin-reach`, flight DD2: the reveal gate's decision function, the
// per-document mark/grant store, and the shared display cleaner. Every dialog is a fake that records its
// options and settles on command or on abort (never a stub that always says yes).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createRevealGate,
  createDocumentMarks,
  CONFIRM_TIMEOUT_MS,
  isRevealCancelInput,
  handleRevealInputEvent
} = require('../../src/main/reveal-gate');
const { cleanDisplayText } = require('../../src/main/display-text');
const { makeTestRevealGate } = require('../helpers/reveal-gate-fixture');

const REQ = {
  channel: 'internal-vault-reveal',
  action: 'reveal',
  subject: 'Bank',
  grant: { vaultId: 'v', itemId: 'i1' }
};
const flush = () => new Promise((r) => setImmediate(r));

/** A controllable timer so the 60 s bound runs without waiting. */
function fakeTimers() {
  /** @type {Array<{ fn: () => void, ms: number, live: boolean }>} */
  const timers = [];
  return {
    timers,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.live = false;
    },
    fire: () => timers.filter((t) => t.live).forEach((t) => t.fn())
  };
}

test('AC2: not applicable iff no admin session AND the document is unmarked - no dialog, no state', async () => {
  const rg = makeTestRevealGate();
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'not-applicable');
  assert.equal(rg.dialogs.length, 0);
  assert.equal(rg.watchers.length, 0);
  assert.equal(rg.gate.openCount(), 0);
  assert.deepEqual(rg.lines, [], 'no trace line for not-applicable');
  assert.equal(rg.marks.size(), 0);
});

test('AC2: either condition alone applies the gate', async () => {
  const a = makeTestRevealGate({ admin: true });
  const pa = a.gate.confirm(a.event(7), REQ);
  await flush();
  assert.equal(a.dialogs.length, 1);
  a.dialogs[0].answer(1);
  assert.equal(await pa, 'confirmed');
  assert.match(a.lines[0], /reason=admin-attached/);

  const t = makeTestRevealGate({ scripted: [7] });
  const pt = t.gate.confirm(t.event(7), REQ);
  await flush();
  assert.equal(t.dialogs.length, 1);
  t.dialogs[0].answer(0);
  assert.equal(await pt, 'denied');
  assert.match(t.lines[0], /reason=touched/);

  // another tab's document is unmarked: not applicable
  assert.equal(await t.gate.confirm(t.event(8), REQ), 'not-applicable');
});

test('AC1/AC3: a throwing admin reader or touched lookup counts as applicable; never throws', async () => {
  const lines = [];
  const mk = (over) =>
    createRevealGate({
      hasAdminSession: () => false,
      isTouched: () => false,
      showConfirm: () => new Promise(() => {}),
      windowFor: () => null,
      watch: () => () => {},
      trace: (l) => lines.push(l),
      ...over
    });
  const ev = { sender: { id: 1, mainFrame: { frameTreeNodeId: 1 } }, senderFrame: { frameTreeNodeId: 1 } };
  // touched lookup throws -> touched -> applies -> no window -> gone
  assert.equal(
    await mk({
      isTouched: () => {
        throw new Error('x');
      }
    }).confirm(ev, REQ),
    'gone'
  );
  // admin reader throws -> admin -> applies
  assert.equal(
    await mk({
      hasAdminSession: () => {
        throw new Error('x');
      }
    }).confirm(ev, REQ),
    'gone'
  );
  assert.match(lines.join('\n'), /reason=touched/);
  assert.match(lines.join('\n'), /reason=admin-attached/);
  // garbage input never throws
  assert.equal(await mk({ hasAdminSession: () => true }).confirm(null, REQ), 'refused-frame');
  assert.equal(await mk({ hasAdminSession: () => true }).confirm(undefined, undefined), 'refused-frame');
});

test('AC3: the sender must be the main frame - null frame, subframe, throwing getter are refused', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const base = rg.event(7);
  assert.equal(await rg.gate.confirm({ ...base, senderFrame: null }, REQ), 'refused-frame');
  assert.equal(await rg.gate.confirm({ ...base, senderFrame: { frameTreeNodeId: 2 } }, REQ), 'refused-frame');
  const throwing = {
    sender: base.sender,
    get senderFrame() {
      throw new Error('disposed');
    }
  };
  assert.equal(await rg.gate.confirm(throwing, REQ), 'refused-frame');
  assert.equal(rg.dialogs.length, 0);
  // and when it does NOT apply, the frame is left to the origin check
  const idle = makeTestRevealGate();
  assert.equal(await idle.gate.confirm({ ...idle.event(7), senderFrame: null }, REQ), 'not-applicable');
});

test('AC4: the dialog - parented on the sender window, Cancel first, default and cancel on Cancel, noLink', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  const d = rg.dialogs[0];
  assert.equal(d.win, rg.windowOf(7));
  assert.equal(d.options.type, 'question');
  assert.equal(d.options.buttons[0], 'Cancel');
  assert.equal(d.options.buttons.length, 2);
  assert.equal(d.options.defaultId, 0);
  assert.equal(d.options.cancelId, 0);
  assert.equal(d.options.noLink, true);
  assert.match(d.options.message, /Bank/);
  assert.match(d.options.detail, /automation connection has been active in this browser recently/);
  assert.match(d.options.detail, /able to read/);
  assert.ok(d.signal instanceof AbortSignal);
  d.answer(1);
  assert.equal(await p, 'confirmed');
});

test('AC4: only the affirmative index confirms; the already-aborted shape (no response key) is a refusal', async () => {
  for (const reply of [{ response: 0, cancelId: 0 }, { cancelId: 0 }, {}, null, { response: 7 }]) {
    const lines = [];
    const gate = createRevealGate({
      hasAdminSession: () => true,
      isTouched: () => false,
      showConfirm: async () => reply,
      windowFor: () => ({}),
      watch: () => () => {},
      trace: (l) => lines.push(l)
    });
    const ev = { sender: { id: 1, mainFrame: { frameTreeNodeId: 1 } }, senderFrame: { frameTreeNodeId: 1 } };
    assert.equal(await gate.confirm(ev, REQ), 'denied', JSON.stringify(reply));
  }
});

test('AC4/AC5: text comes from main data only and is cleaned and bounded; a payload field is never read', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const nasty = 'Bank‮"evil"\n\n  line​' + 'x'.repeat(500);
  const p = rg.gate.confirm(rg.event(7), {
    ...REQ,
    subject: nasty,
    // anything else a caller might smuggle in must not reach the dialog
    payloadText: 'FROM-PAYLOAD',
    detail: 'FROM-PAYLOAD'
  });
  await flush();
  const { message, detail, buttons } = rg.dialogs[0].options;
  assert.ok(!/FROM-PAYLOAD/.test(JSON.stringify(rg.dialogs[0].options)));
  assert.ok(!message.includes('‮') && !message.includes('​') && !message.includes('\n'));
  // the subject portion is capped at 80 characters (ellipsis included)
  const subject = message.match(/in "(.*)"\?$/)[1];
  assert.ok(subject.length <= 80, `subject ${subject.length}`);
  assert.ok(subject.endsWith('…'));
  assert.ok(detail.length > 0 && buttons.length === 2);
  rg.dialogs[0].answer(0);
  await p;
});

test('AC5: cleanDisplayText - one table: control/format/quotes removed, whitespace collapsed, capped, sliced first', () => {
  assert.equal(cleanDisplayText('  a \t\n b  ', 80), 'a b');
  assert.equal(cleanDisplayText('a‮b​c"d“e', 80), 'abcde');
  assert.equal(cleanDisplayText('x'.repeat(100), 10), 'x'.repeat(9) + '…');
  assert.equal(cleanDisplayText(undefined, 10), '');
  assert.equal(cleanDisplayText(42, 10), '');
  // never splits a surrogate pair at the cut
  const out = cleanDisplayText('a'.repeat(8) + '\u{1F600}\u{1F600}', 10);
  assert.ok(!/[\ud800-\udbff]$/.test(out.slice(0, -1)));
  // a huge input is sliced BEFORE any regexp runs (bounded work)
  const t0 = Date.now();
  cleanDisplayText(' '.repeat(5_000_000) + 'x', 80);
  assert.ok(Date.now() - t0 < 500);
});

test('AC6: a second request for the same window is busy at once; another window is not blocked', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p1 = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(await rg.gate.confirm(rg.event(7), { ...REQ, grant: undefined, action: 'cookie' }), 'busy');
  assert.equal(rg.dialogs.length, 1, 'no second dialog');
  const p2 = rg.gate.confirm(rg.event(9), REQ);
  await flush();
  assert.equal(rg.dialogs.length, 2);
  assert.equal(rg.dialogs[1].win, rg.windowOf(9));
  rg.dialogs[0].answer(1);
  rg.dialogs[1].answer(0);
  assert.equal(await p1, 'confirmed');
  assert.equal(await p2, 'denied');
  assert.equal(rg.gate.openCount(), 0, 'slot released');
  // after the first closed, a new request can open a dialog again
  const p3 = rg.gate.confirm(rg.event(7), { ...REQ, grant: undefined });
  await flush();
  assert.equal(rg.dialogs.length, 3);
  rg.dialogs[2].answer(0);
  await p3;
});

test('AC6: 60 s with no answer aborts the dialog (timeout) and releases the slot', async () => {
  const ft = fakeTimers();
  const rg = makeTestRevealGate({ admin: true, setTimeout: ft.setTimeout, clearTimeout: ft.clearTimeout });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(ft.timers.length, 1);
  assert.equal(ft.timers[0].ms, 60000);
  assert.equal(CONFIRM_TIMEOUT_MS, 60000);
  ft.fire();
  assert.equal(await p, 'timeout');
  assert.equal(rg.dialogs[0].signal.aborted, true);
  assert.equal(rg.gate.openCount(), 0);
  assert.equal(rg.watchers.length, 0, 'watchers disposed');
  assert.match(rg.lines.at(-1), /decision=timeout reason=admin-attached/);
});

test('AC6: a new main-frame document, the sender destroyed, or the window closing aborts as gone', async () => {
  for (const how of ['navigate', 'closeWindow']) {
    const rg = makeTestRevealGate({ admin: true });
    const p = rg.gate.confirm(rg.event(7), REQ);
    await flush();
    rg[how](7);
    assert.equal(await p, 'gone', how);
    assert.equal(rg.dialogs[0].signal.aborted, true);
    assert.equal(rg.gate.openCount(), 0);
  }
});

test('AC6: the slot is released on the abort, even when showConfirm never settles', async () => {
  const rg = makeTestRevealGate({ admin: true, neverSettles: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.closeWindow(7);
  assert.equal(await p, 'gone');
  assert.equal(rg.gate.openCount(), 0);
  // a later request on the same window is not stuck busy
  const p2 = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, 2);
  rg.closeWindow(7);
  assert.equal(await p2, 'gone');
});

test('AC6/edge: no window for the sender is gone (never an unparented dialog); showConfirm rejecting is denied', async () => {
  const none = makeTestRevealGate({ admin: true, hasWindow: () => false });
  assert.equal(await none.gate.confirm(none.event(7), REQ), 'gone');
  assert.equal(none.dialogs.length, 0);

  const gate = createRevealGate({
    hasAdminSession: () => true,
    isTouched: () => false,
    showConfirm: () => Promise.reject(new Error('native failure')),
    windowFor: () => ({}),
    watch: () => () => {}
  });
  const ev = { sender: { id: 1, mainFrame: { frameTreeNodeId: 1 } }, senderFrame: { frameTreeNodeId: 1 } };
  assert.equal(await gate.confirm(ev, REQ), 'denied');
  assert.equal(gate.openCount(), 0);
  // a watch that throws is gone, slot released
  const g2 = createRevealGate({
    hasAdminSession: () => true,
    isTouched: () => false,
    showConfirm: () => new Promise(() => {}),
    windowFor: () => ({}),
    watch: () => {
      throw new Error('emitter gone');
    }
  });
  assert.equal(await g2.confirm(ev, REQ), 'gone');
  assert.equal(g2.openCount(), 0);
});

test('AC7: one grant per (vault, item, document) for reveal AND code; nothing else is remembered', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const ask = async (id, req, answer) => {
    const p = rg.gate.confirm(rg.event(id), req);
    await flush();
    if (answer !== undefined) rg.dialogs.at(-1).answer(answer);
    return p;
  };
  const n0 = rg.dialogs.length;
  assert.equal(await ask(7, REQ, 1), 'confirmed');
  assert.equal(rg.dialogs.length, n0 + 1);
  // the same item again (a reveal, then a code read) - same document - no dialog
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'confirmed');
  assert.equal(
    await rg.gate.confirm(rg.event(7), { ...REQ, channel: 'internal-vault-totp-code', action: 'code' }),
    'confirmed'
  );
  assert.equal(rg.dialogs.length, n0 + 1, 'no further dialog for the granted item');
  // another item asks
  assert.equal(await ask(7, { ...REQ, grant: { vaultId: 'v', itemId: 'i2' } }, 0), 'denied');
  // the same item in another vault asks
  assert.equal(await ask(7, { ...REQ, grant: { vaultId: 'w', itemId: 'i1' } }, 0), 'denied');
  // the same item from another tab asks
  assert.equal(await ask(8, REQ, 0), 'denied');
  // a cookie / export / mint never takes or consults a grant
  assert.equal(await ask(7, { channel: 'c', action: 'cookie', subject: 'a (b)' }, 0), 'denied');
  assert.equal(await ask(7, { channel: 'e', action: 'export', subject: 'Global' }, 0), 'denied');
  assert.equal(await ask(7, { channel: 'm', action: 'admin-key-mint' }, 0), 'denied');
  // after the document's next main-frame commit it asks again
  rg.navigate(7);
  const before = rg.dialogs.length;
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, before + 1);
  rg.dialogs.at(-1).answer(1);
  assert.equal(await p, 'confirmed');
});

test('AC7: a denied or timed-out confirmation grants nothing', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.dialogs[0].answer(0);
  assert.equal(await p, 'denied');
  assert.equal(rg.marks.hasGrant(7, 'v\u0000i1'), false);
  const p2 = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, 2);
  rg.dialogs[1].answer(0);
  await p2;
});

test('AC7: the gate stays quiet on a granted item even while another dialog is open for the window', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.dialogs[0].answer(1);
  await p;
  const open = rg.gate.confirm(rg.event(7), { channel: 'c', action: 'cookie', subject: 'x' });
  await flush();
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'confirmed');
  rg.dialogs.at(-1).answer(0);
  await open;
});

test('AC8: one trace line per non-not-applicable decision: channel, decision, reason - never a name or id', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), { ...REQ, subject: 'SECRET-NAME-123' });
  await flush();
  rg.dialogs[0].answer(0);
  await p;
  assert.deepEqual(rg.lines, ['[reveal-gate] channel=internal-vault-reveal decision=denied reason=admin-attached']);
  assert.ok(!/SECRET-NAME-123|v\b|i1/.test(rg.lines.join('')));
});

test('AC11: the marks store - mark, commit drops it (and grants), destroy drops it, in-page keeps it', () => {
  const m = createDocumentMarks();
  m.markScripted(5);
  m.grant(5, 'k');
  assert.equal(m.isScripted(5), true);
  assert.equal(m.isScripted(6), false);
  assert.equal(m.hasGrant(5, 'k'), true);
  // an in-page navigation never calls onCommit (did-navigate-in-page is not wired): state stays
  assert.equal(m.isScripted(5), true);
  m.onCommit(5);
  assert.equal(m.isScripted(5), false);
  assert.equal(m.hasGrant(5, 'k'), false);
  m.markScripted(5);
  m.forget(5);
  assert.equal(m.isScripted(5), false);
  assert.equal(m.size(), 0);
  // a non-number id is ignored
  m.markScripted(/** @type {any} */ ('x'));
  assert.equal(m.size(), 0);
});

// ---------------------------------------------------------------------------------------------------
// Leg `hat-and-alignment`, fix 1: a confirmation could strand its window. Three rules - a background tab
// gets no dialog; a tab leaving the front cancels its pending confirmation; real input to the window
// cancels it after a 400 ms grace period. All decisions stay inside the existing set.

const { INPUT_GRACE_MS } = require('../../src/main/reveal-gate');

test('rule 1: an inactive sender is refused at once as gone - no dialog, no slot, trace line, interrupted flag', async () => {
  const rg = makeTestRevealGate({ admin: true, isActive: () => false });
  const info = {};
  assert.equal(await rg.gate.confirm(rg.event(7), REQ, info), 'gone');
  assert.equal(info.interrupted, true);
  assert.equal(rg.dialogs.length, 0);
  assert.equal(rg.gate.openCount(), 0);
  assert.equal(rg.watchers.length, 0);
  assert.deepEqual(rg.lines, ['[reveal-gate] channel=internal-vault-reveal decision=gone reason=admin-attached']);
});

test('rule 1: not-applicable still wins for an unaffected page, even when inactive', async () => {
  const rg = makeTestRevealGate({ isActive: () => false });
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'not-applicable');
  assert.deepEqual(rg.lines, []);
});

test('rule 1: the touched reason is traced for a scripted inactive page', async () => {
  const rg = makeTestRevealGate({ scripted: [7], isActive: () => false });
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'gone');
  assert.match(rg.lines[0], /decision=gone reason=touched/);
});

test('rule 1: inactive precedes a grant - a background tab is never answered from one', async () => {
  let active = true;
  const rg = makeTestRevealGate({ admin: true, isActive: () => active });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.dialogs[0].answer(1);
  assert.equal(await p, 'confirmed');
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'confirmed', 'granted while in front');
  active = false;
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'gone');
});

test('rule 1: inactive precedes busy - a background tab never reports busy', async () => {
  // both tabs live in ONE window
  const rg = makeTestRevealGate({ admin: true, sameWindow: true, isActive: (s) => s.id === 7 });
  const first = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.gate.openCount(), 1);
  assert.equal(await rg.gate.confirm(rg.event(9), REQ), 'gone');
  assert.equal(rg.gate.openCount(), 1, 'the active tab keeps its slot');
  rg.dialogs[0].answer(0);
  assert.equal(await first, 'denied');
});

test('rule 1: an isActive that throws counts as inactive', async () => {
  const rg = makeTestRevealGate({
    admin: true,
    isActive: () => {
      throw new Error('x');
    }
  });
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'gone');
  assert.equal(rg.dialogs.length, 0);
});

test('rule 2: tabInactive settles the pending confirmation as gone, aborts its signal, frees the slot', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const info = {};
  const p = rg.gate.confirm(rg.event(7), REQ, info);
  await flush();
  assert.equal(rg.gate.openCount(), 1);
  rg.gate.tabInactive(7);
  assert.equal(await p, 'gone');
  assert.equal(info.interrupted, true);
  assert.equal(rg.dialogs[0].signal.aborted, true);
  assert.equal(rg.gate.openCount(), 0);
  assert.equal(rg.watchers.length, 0);
  // the slot is free: a following request gets its own dialog
  const next = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, 2);
  rg.dialogs[1].answer(1);
  assert.equal(await next, 'confirmed');
});

test('rule 2: another tab or window is untouched; a call with nothing pending, or after settle, is a no-op', async () => {
  const rg = makeTestRevealGate({ admin: true });
  rg.gate.tabInactive(7); // nothing pending
  const p = rg.gate.confirm(rg.event(7), REQ);
  const q = rg.gate.confirm(rg.event(8), REQ); // tab 8: its own window object
  await flush();
  assert.equal(rg.gate.openCount(), 2);
  rg.gate.tabInactive(99);
  rg.gate.tabInactive(8);
  assert.equal(await q, 'gone');
  assert.equal(rg.dialogs[0].signal.aborted, false, 'tab 7 untouched');
  rg.dialogs[0].answer(1);
  assert.equal(await p, 'confirmed');
  rg.gate.tabInactive(7); // after settle
  assert.equal(rg.gate.openCount(), 0);
});

test('rule 2: a navigation gone is not interrupted', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const info = {};
  const p = rg.gate.confirm(rg.event(7), REQ, info);
  await flush();
  rg.navigate(7);
  assert.equal(await p, 'gone');
  assert.equal(info.interrupted, undefined);
});

function clocked() {
  const t = { v: 1000 };
  return { t, rg: makeTestRevealGate({ admin: true, now: () => t.v }) };
}

test('rule 3: input after the grace period cancels; the window answers afterwards', async () => {
  const { t, rg } = clocked();
  const info = {};
  const p = rg.gate.confirm(rg.event(7), REQ, info);
  await flush();
  t.v += INPUT_GRACE_MS;
  rg.gate.windowInput(rg.windowOf(7));
  assert.equal(await p, 'gone');
  assert.equal(info.interrupted, true);
  assert.equal(rg.dialogs[0].signal.aborted, true);
  assert.equal(rg.gate.openCount(), 0);
});

test('rule 3: input inside the grace period does not cancel; the same input just after it does', async () => {
  const { t, rg } = clocked();
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  t.v += INPUT_GRACE_MS - 1;
  rg.gate.windowInput(rg.windowOf(7));
  assert.equal(rg.gate.openCount(), 1);
  t.v += 1;
  rg.gate.windowInput(rg.windowOf(7));
  assert.equal(await p, 'gone');
});

test('rule 3: input to another window, or with nothing pending, does nothing', async () => {
  const { t, rg } = clocked();
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  t.v += 5000;
  rg.gate.windowInput(rg.windowOf(8));
  rg.gate.windowInput(undefined);
  assert.equal(rg.gate.openCount(), 1);
  rg.dialogs[0].answer(1);
  assert.equal(await p, 'confirmed');
  rg.gate.windowInput(rg.windowOf(7)); // nothing pending
});

test('the grace constant is 400 ms', () => {
  assert.equal(INPUT_GRACE_MS, 400);
});

test('settle-once: a late affirmative answer after tabInactive stays gone, stores no grant, no read', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.gate.tabInactive(7);
  rg.dialogs[0].answer(1);
  assert.equal(await p, 'gone');
  assert.equal(rg.gate.openCount(), 0);
  const again = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, 2, 'no grant was stored: the same item asks again');
  rg.dialogs[1].answer(0);
  assert.equal(await again, 'denied');
});

test('settle-once: a late affirmative answer after windowInput stays gone, stores no grant', async () => {
  const { t, rg } = clocked();
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  t.v += INPUT_GRACE_MS;
  rg.gate.windowInput(rg.windowOf(7));
  rg.dialogs[0].answer(1);
  assert.equal(await p, 'gone');
  const again = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, 2);
  rg.dialogs[1].answer(0);
  assert.equal(await again, 'denied');
});

test('settle-once: an affirmative answer first makes a later tabInactive / windowInput a no-op', async () => {
  const { t, rg } = clocked();
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.dialogs[0].answer(1);
  assert.equal(await p, 'confirmed');
  t.v += INPUT_GRACE_MS;
  rg.gate.tabInactive(7);
  rg.gate.windowInput(rg.windowOf(7));
  assert.equal(await p, 'confirmed');
  const again = rg.gate.confirm(rg.event(7), REQ);
  assert.equal(await again, 'confirmed', 'the grant stands');
});

test('isRevealCancelInput: InputEvent shapes - press and key down (not auto-repeat) cancel, nothing else', () => {
  const yes = [
    { type: 'mouseDown', modifiers: [] },
    { type: 'rawKeyDown', modifiers: [] },
    { type: 'keyDown', modifiers: [] },
    { type: 'keyDown' },
    { type: 'rawKeyDown', modifiers: ['shift'] }
  ];
  for (const i of yes) assert.equal(isRevealCancelInput(i), true, JSON.stringify(i));
  const no = [
    { type: 'rawKeyDown', modifiers: ['isautorepeat'] },
    { type: 'keyDown', modifiers: ['shift', 'isautorepeat'] },
    ...['mouseUp', 'mouseMove', 'keyUp', 'char', 'mouseWheel'].map((type) => ({ type, modifiers: [] })),
    null,
    undefined,
    {},
    { modifiers: [] }
  ];
  for (const i of no) assert.equal(isRevealCancelInput(i), false, JSON.stringify(i));
});

test('handleRevealInputEvent: the shared order - type, then injecting, then the call; never throws', () => {
  const calls = [];
  const run = (input, injectedInput, wcId = 5) =>
    handleRevealInputEvent({ input, wcId, injectedInput, win: 'W', windowInput: (w) => calls.push(w) });
  run({ type: 'mouseDown', modifiers: [] }, { isInjecting: () => false });
  run({ type: 'rawKeyDown', modifiers: [] }, { isInjecting: () => false });
  run({ type: 'keyDown', modifiers: [] }, undefined);
  assert.deepEqual(calls, ['W', 'W', 'W']);
  calls.length = 0;
  run({ type: 'rawKeyDown', modifiers: ['isautorepeat'] }, undefined);
  for (const type of ['mouseUp', 'mouseMove', 'keyUp', 'char', 'mouseWheel']) run({ type, modifiers: [] }, undefined);
  run(null, undefined);
  run({ modifiers: [] }, undefined);
  assert.deepEqual(calls, []);
  // injecting: chrome id and a guest id
  const seen = [];
  const inj = { isInjecting: (id) => (seen.push(id), true) };
  run({ type: 'mouseDown', modifiers: [] }, inj, 1);
  run({ type: 'keyDown', modifiers: [] }, inj, 42);
  assert.deepEqual(calls, []);
  assert.deepEqual(seen, [1, 42]);
  // a throwing injected store or gate does not escape
  assert.doesNotThrow(() =>
    run(
      { type: 'mouseDown' },
      {
        isInjecting: () => {
          throw new Error('x');
        }
      }
    )
  );
});
