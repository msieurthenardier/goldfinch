'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// menu-controller.js attaches global pointerdown/blur listeners at module load
// (document.addEventListener / window.addEventListener) and reads
// document.activeElement inside the menu-keydown handler. Since the M05 F8
// cutover the module is loaded ONLY by the menu-overlay sheet document
// (menu-overlay.html) — its global listeners are the sheet's outside-click/blur
// dismissal. Node has no DOM, so we install minimal stand-ins BEFORE requiring
// the module. activeElement is a mutable field the roving-tabindex assertions
// point at a fake item.
const documentStub = {
  addEventListener() {},
  /** @type {any} */ activeElement: null,
};
globalThis.document = /** @type {any} */ (documentStub);
globalThis.window = /** @type {any} */ ({ addEventListener() {} });

const { menuController, focusItem } = require('../../src/renderer/menu-controller');

// ---------------------------------------------------------------------------
// Fakes. A trigger/menu is a plain object whose addEventListener records the
// handler by event type, with contains() + a focus spy. onOpen/onClose/focusReturn
// are recording spies. By default trigger and menu are distinct nodes (the normal
// menu-button case); pass { sameNode: true } for the sheet-template consumers
// (menu-overlay.js registers every template entry with trigger === menu — the
// opener-skip, programmatic-open path).
// ---------------------------------------------------------------------------
function makeNode() {
  /** @type {Record<string, (e:any)=>void>} */
  const handlers = {};
  return {
    handlers,
    focusCalls: 0,
    addEventListener(/** @type {string} */ type, /** @type {(e:any)=>void} */ fn) {
      handlers[type] = fn;
    },
    contains() {
      return false;
    },
    focus() {
      this.focusCalls++;
    },
  };
}

function spy() {
  /** @type {any[][]} */
  const calls = [];
  const fn = (/** @type {any[]} */ ...args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

/**
 * @param {{ sameNode?: boolean, withItems?: boolean, withFocusReturn?: boolean, itemCount?: number }} [opts]
 */
function makeFakeEntry(opts = {}) {
  const trigger = makeNode();
  const menu = opts.sameNode ? trigger : makeNode();
  const onOpen = spy();
  const onClose = spy();
  const focusReturn = opts.withFocusReturn ? spy() : undefined;

  // Roving-tabindex item fakes: each is an object with a focus spy + writable
  // tabIndex, so the real focusItem can act on them. activeElement starts at the
  // first item (so idx resolves to 0 and ArrowDown lands on 1, etc.).
  /** @type {Array<{ focus():void, focusCalls:number, tabIndex:number }>} */
  const items = [];
  if (opts.withItems) {
    const n = opts.itemCount ?? 3;
    for (let i = 0; i < n; i++) {
      const it = {
        focusCalls: 0,
        tabIndex: -1,
        focus() {
          it.focusCalls++;
        },
      };
      items.push(it);
    }
  }

  /** @type {any} */
  const entry = {
    trigger,
    menu,
    onOpen,
    onClose,
  };
  if (opts.withItems) entry.items = () => items;
  if (focusReturn) entry.focusReturn = focusReturn;

  menuController.register(entry);
  return { entry, trigger, menu, onOpen, onClose, focusReturn, items };
}

// ---------------------------------------------------------------------------
// State machine: mutual exclusion, closeAll/current
// ---------------------------------------------------------------------------
test('opening B closes A (mutual exclusion); current tracks the open entry', () => {
  const a = makeFakeEntry();
  const b = makeFakeEntry();

  menuController.open(a.entry);
  assert.equal(menuController.current, a.entry);
  assert.equal(a.onOpen.calls.length, 1);

  menuController.open(b.entry);
  assert.equal(a.onClose.calls.length, 1, 'opening B should close A');
  assert.equal(b.onOpen.calls.length, 1);
  assert.equal(menuController.current, b.entry);

  menuController.closeAll(); // cleanup so later tests start with nothing open
});

test('closeAll closes the current entry and clears current', () => {
  const a = makeFakeEntry();
  menuController.open(a.entry);
  assert.equal(menuController.current, a.entry);

  menuController.closeAll();
  assert.equal(a.onClose.calls.length, 1);
  assert.equal(menuController.current, null);
});

test('open passes startIndex through to onOpen', () => {
  const a = makeFakeEntry();
  menuController.open(a.entry, -1);
  assert.deepEqual(a.onOpen.calls[0], [-1]);
  menuController.closeAll();
});

// ---------------------------------------------------------------------------
// Trigger-keydown opener (APG menu-button) + the trigger === menu skip
// ---------------------------------------------------------------------------
test('trigger keydown: ArrowDown opens to first item (onOpen(0))', () => {
  const a = makeFakeEntry();
  a.trigger.handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.deepEqual(a.onOpen.calls[0], [0]);
  menuController.closeAll();
});

test('trigger keydown: ArrowUp opens to last item (onOpen(-1))', () => {
  const a = makeFakeEntry();
  a.trigger.handlers.keydown({ key: 'ArrowUp', preventDefault() {} });
  assert.deepEqual(a.onOpen.calls[0], [-1]);
  menuController.closeAll();
});

test('trigger keydown: Enter and Space open to first item', () => {
  const a = makeFakeEntry();
  a.trigger.handlers.keydown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(a.onOpen.calls[0], [0]);
  menuController.closeAll();

  const b = makeFakeEntry();
  b.trigger.handlers.keydown({ key: ' ', preventDefault() {} });
  assert.deepEqual(b.onOpen.calls[0], [0]);
  menuController.closeAll();
});

test('trigger === menu: no opener wired (programmatic-open consumer)', () => {
  const a = makeFakeEntry({ sameNode: true });
  // The only keydown handler on the shared node is the menu-keydown handler; the
  // trigger opener was skipped. So an ArrowDown does NOT call onOpen as an opener.
  // (The menu-keydown handler returns early because this fake has no items.)
  a.trigger.handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(a.onOpen.calls.length, 0, 'opener must be skipped when trigger === menu');
  menuController.closeAll();
});

// ---------------------------------------------------------------------------
// Menu-keydown contract: Escape/Tab close + focus return; no-items no-op
// ---------------------------------------------------------------------------
test('menu keydown Escape: closes + returns focus to trigger (no focusReturn)', () => {
  const a = makeFakeEntry({ withItems: true });
  menuController.open(a.entry);
  a.menu.handlers.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(a.onClose.calls.length, 1);
  assert.equal(a.trigger.focusCalls, 1, 'default focus-return is trigger.focus()');
});

test('menu keydown Tab: closes + returns focus to trigger (no focusReturn)', () => {
  const a = makeFakeEntry({ withItems: true });
  menuController.open(a.entry);
  a.menu.handlers.keydown({ key: 'Tab', preventDefault() {} });
  assert.equal(a.onClose.calls.length, 1);
  assert.equal(a.trigger.focusCalls, 1);
});

test('menu keydown Escape: uses focusReturn when present (not trigger.focus)', () => {
  const a = makeFakeEntry({ withItems: true, withFocusReturn: true });
  menuController.open(a.entry);
  a.menu.handlers.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(a.onClose.calls.length, 1);
  assert.equal(a.focusReturn?.calls.length, 1, 'focusReturn should be preferred');
  assert.equal(a.trigger.focusCalls, 0, 'trigger.focus must NOT be called when focusReturn present');
});

test('menu keydown on a no-items entry: no throw, no roving, no close', () => {
  const a = makeFakeEntry(); // no items getter
  menuController.open(a.entry);
  assert.doesNotThrow(() => {
    a.menu.handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  });
  // The handler returns early at `if (!entry.items) return` — no roving, and the
  // Escape/Tab close path is also unreachable, so the menu stays open.
  assert.equal(a.onClose.calls.length, 0);
  menuController.closeAll();
});

// ---------------------------------------------------------------------------
// With-items roving path: ArrowDown / Home / End select the expected index via
// the real focusItem (asserted through the item focus spies).
// ---------------------------------------------------------------------------
test('menu keydown ArrowDown: rove from item 0 to item 1', () => {
  const a = makeFakeEntry({ withItems: true, itemCount: 3 });
  menuController.open(a.entry);
  documentStub.activeElement = a.items[0]; // idx resolves to 0 → ArrowDown picks 1
  a.menu.handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(a.items[1].focusCalls, 1, 'ArrowDown should focus the next item');
  assert.equal(a.items[1].tabIndex, 0, 'focused item gets tabIndex 0 (roving)');
  assert.equal(a.items[0].tabIndex, -1, 'unfocused items get tabIndex -1');
  documentStub.activeElement = null;
  menuController.closeAll();
});

test('menu keydown Home: rove to first item; End: rove to last item', () => {
  const a = makeFakeEntry({ withItems: true, itemCount: 3 });
  menuController.open(a.entry);
  documentStub.activeElement = a.items[2];

  a.menu.handlers.keydown({ key: 'Home', preventDefault() {} });
  assert.equal(a.items[0].focusCalls, 1, 'Home focuses the first item');

  a.menu.handlers.keydown({ key: 'End', preventDefault() {} });
  assert.equal(a.items[2].focusCalls, 1, 'End focuses the last item');

  documentStub.activeElement = null;
  menuController.closeAll();
});

test('menu keydown ArrowUp from item 0 wraps to the last item', () => {
  const a = makeFakeEntry({ withItems: true, itemCount: 3 });
  menuController.open(a.entry);
  documentStub.activeElement = a.items[0]; // idx 0, ArrowUp → -1 → wraps to last (2)
  a.menu.handlers.keydown({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(a.items[2].focusCalls, 1, 'ArrowUp from first wraps to last');
  documentStub.activeElement = null;
  menuController.closeAll();
});

// ---------------------------------------------------------------------------
// focusItem directly: wrap math (negatives + overflow)
// ---------------------------------------------------------------------------
test('focusItem wraps negative and overflow indices', () => {
  const items = [0, 1, 2].map(() => {
    const it = { focusCalls: 0, tabIndex: -1, focus() { it.focusCalls++; } };
    return it;
  });
  focusItem(/** @type {any} */ (items), -1);
  assert.equal(items[2].focusCalls, 1, '-1 wraps to last');
  focusItem(/** @type {any} */ (items), 3);
  assert.equal(items[0].focusCalls, 1, '3 wraps to first');
});
