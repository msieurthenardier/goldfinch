'use strict';

// Sortie 06 Leg 3 (AC3): the pure prompt-view key decision.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { savePromptKeyAction } = require('../../src/main/save-prompt-keys');

const kd = (key, extra = {}) => ({ type: 'keyDown', key, ...extra });

test('AC3: F6 -> to-address, Shift+F6 -> to-guest, Escape -> dismiss', () => {
  assert.equal(savePromptKeyAction(kd('F6')), 'to-address');
  assert.equal(savePromptKeyAction(kd('F6', { shift: true })), 'to-guest');
  assert.equal(savePromptKeyAction(kd('Escape')), 'dismiss');
});

test('AC3: everything else is null (Tab, Shift+Tab, Enter, Space, keyUp, modified F6/Escape)', () => {
  const nulls = [
    kd('Tab'),
    kd('Tab', { shift: true }),
    kd('Enter'),
    kd(' '),
    kd('a'),
    { type: 'keyUp', key: 'F6' },
    { type: 'keyUp', key: 'Escape' },
    kd('F6', { control: true }),
    kd('F6', { meta: true }),
    kd('F6', { alt: true }),
    kd('F6', { shift: true, control: true }),
    kd('Escape', { control: true }),
    kd('Escape', { alt: true }),
    kd('Escape', { meta: true }),
    kd('Escape', { shift: true }),
    null,
    undefined,
    {}
  ];
  for (const input of nulls) assert.equal(savePromptKeyAction(input), null, JSON.stringify(input));
});
