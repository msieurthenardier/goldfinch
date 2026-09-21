'use strict';

// Single source of truth for src/renderer/renderer.js's line-count pin (squawk 0096).
//
// Two independent test files each need this number and, by design, need it to be the
// SAME number:
//
//   - test/unit/seam-contract.test.js's RENDERER_LINE_BUDGET (a `<=` ceiling — the house
//     line-budget discipline documented in CLAUDE.md's "Formatting is Prettier's" bullet).
//   - test/unit/vault-restore-workflow-invariants.test.js's exact-equality pin (left from
//     M18 F3 Leg 3's "this leg touches nothing in renderer.js" invariant, and retargeted
//     in lockstep by every leg since — see that file's own retarget history comment).
//
// These read as two different intents (a ceiling vs. an exact lockstep), but
// renderer.js's OWN line-budget ruling is zero-headroom: "No slack banked beyond the
// landed value" (seam-contract.test.js's RENDERER_LINE_BUDGET comment, Mission 21
// Flight 3 Leg 1) — unlike BOOKMARKS_BAR_LINE_BUDGET or vault.js's budget, which
// deliberately carry headroom above their landed size. Because renderer.js's ceiling and
// its landed count are the same number by policy, both tests correctly read the one
// value here rather than needing two separately-tracked constants.
//
// A future leg that legitimately changes renderer.js retargets this ONE constant; both
// consuming tests move together and there is nothing left to rediscover.
//
// Test files must not require() each other (node --test executes a required file's own
// tests), which is why this lives in test/helpers/ rather than in either suite.

const RENDERER_LINE_BUDGET = 1550;

module.exports = { RENDERER_LINE_BUDGET };
