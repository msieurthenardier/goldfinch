'use strict';

// M14 F1 L1 carry-forward (M13 debrief action item) — latch-ordering pin.
//
// `contents.__goldfinchNavGuarded = true` MUST be the first statement of
// wireGuestContents, set synchronously: the app-lifecycle web-contents-created
// catch-all cannot distinguish a guest from a chrome/overlay view at ITS
// attach time (that fires during `new WebContentsView()`, before
// wireGuestContents runs), so it reads the latch INSIDE its own navigation
// handler and early-returns for guests. Any statement — and above all any
// `await` — inserted before the assignment reopens the race the latch closes:
// a navigation could start against an unlatched guest and be swallowed by the
// catch-all's preventDefault. Comment-only guarding proved insufficient (M13
// debrief); this source-scan net makes the ordering executable.
//
// Toolkit: test/helpers/source-scan.js (maskComments preserves offsets, so
// the guest-wiring.js header comments cannot satisfy or trip the scan).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

test('latch ordering: __goldfinchNavGuarded is the FIRST statement of wireGuestContents, with no suspension point before it', () => {
  const file = path.join(__dirname, '..', '..', 'src', 'main', 'guest-wiring.js');
  const masked = maskComments(fs.readFileSync(file, 'utf8'));

  // Vacuity guard 1: the subject function must exist (a rename/refactor fails
  // the pin loudly instead of letting it pass on a missing subject).
  const fnMatch = /(async\s+)?function\s+wireGuestContents\s*\(/.exec(masked);
  assert.ok(fnMatch, 'wireGuestContents must exist in src/main/guest-wiring.js');
  assert.equal(
    fnMatch[1],
    undefined,
    'wireGuestContents must not be async — an async body makes a pre-latch suspension point possible'
  );

  // Extract the function BODY: match the parameter list's parens, then the
  // body braces (both bracket walks skip string contents).
  const parenOpen = masked.indexOf('(', fnMatch.index);
  const parenClose = findMatchingBracket(masked, parenOpen, '(', ')');
  assert.ok(parenClose !== -1, 'parameter list must close');
  const bodyOpen = masked.indexOf('{', parenClose);
  const bodyClose = findMatchingBracket(masked, bodyOpen, '{', '}');
  assert.ok(bodyClose !== -1, 'function body must close');
  const body = masked.slice(bodyOpen + 1, bodyClose);

  // Vacuity guard 2: the latch assignment itself must exist inside the body.
  const latchIdx = body.indexOf('contents.__goldfinchNavGuarded = true;');
  assert.ok(latchIdx !== -1, 'the latch assignment must exist inside wireGuestContents');

  const beforeLatch = body.slice(0, latchIdx);
  // THE PIN: nothing but whitespace (comments are already masked to spaces)
  // may precede the assignment — it is the first statement, full stop.
  assert.equal(
    beforeLatch.trim(),
    '',
    'the latch assignment must be the FIRST statement of wireGuestContents — ' +
      'code was found before it (a suspension point here reopens the ' +
      'web-contents-created catch-all race)'
  );
  // Redundant with the check above, but names the exact hazard if the
  // first-statement pin is ever loosened: no await may precede the latch.
  assert.equal(/\bawait\b/.test(beforeLatch), false, 'no await may precede the latch assignment');
});
