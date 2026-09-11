'use strict';

// Pure state-selection tests for src/shared/vault-page-model.js (M12 Flight 3,
// Leg 1 / DD9). No DOM — the page's three-state selection is verified here; live
// aria/keyboard coverage is the F5 HAT (the page is internal-session, so it is not
// axe-auditable — flight DD9).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  selectVaultView,
  compromiseCardRows,
  vaultNavEntries,
  restoreDestinationOptions,
  restoreOutcomeLines,
  browserImportDestinationOptions,
  browserImportSkipLines,
  browserImportOutcomeLines,
  SETTINGS_ID,
  VAULTS_ID
} = require('../../src/shared/vault-page-model.js');

const rows = [
  { vaultId: 'global', label: 'Global' },
  { vaultId: 'personal', label: 'Personal' }
];

test('not set up → mode not-set-up, no vault list', () => {
  const view = selectVaultView({ setUp: false, unlocked: false, vaults: rows });
  assert.equal(view.mode, 'not-set-up');
  assert.deepEqual(view.vaults, []);
});

test('set up but locked → mode locked, labels shown', () => {
  const view = selectVaultView({ setUp: true, unlocked: false, vaults: rows });
  assert.equal(view.mode, 'locked');
  assert.deepEqual(view.vaults, rows);
});

test('set up and unlocked → mode unlocked, labels shown', () => {
  const view = selectVaultView({ setUp: true, unlocked: true, vaults: rows });
  assert.equal(view.mode, 'unlocked');
  assert.deepEqual(view.vaults, rows);
});

test('flags are strict === true (truthy-but-not-true does not unlock)', () => {
  assert.equal(selectVaultView({ setUp: 1, unlocked: 1, vaults: rows }).mode, 'not-set-up');
  assert.equal(selectVaultView({ setUp: true, unlocked: 1, vaults: rows }).mode, 'locked');
});

test('malformed / absent payload degrades to not-set-up with no vaults', () => {
  const empty = { mode: 'not-set-up', vaults: [], adminProvisioned: false, compromiseReport: null, severOffer: null };
  assert.deepEqual(selectVaultView(), empty);
  assert.deepEqual(selectVaultView(null), empty);
  assert.deepEqual(selectVaultView({ setUp: true, unlocked: true }), {
    mode: 'unlocked',
    vaults: [],
    adminProvisioned: false,
    compromiseReport: null,
    severOffer: null
  });
});

// ---------------------------------------------------------------------------
// M18 F3 L3 (DD7): severOffer — the same defensive-normalization + lock-state
// matrix discipline as compromiseReport above.
// ---------------------------------------------------------------------------

test('DD7 matrix: severOffer rides BOTH the locked and unlocked views (the card persists; route flips live with lock state)', () => {
  for (const unlocked of [true, false]) {
    const view = selectVaultView({
      setUp: true,
      unlocked,
      vaults: rows,
      severOffer: { route: unlocked ? 'change-master' : 'recover' }
    });
    assert.equal(view.mode, unlocked ? 'unlocked' : 'locked');
    assert.deepEqual(view.severOffer, { route: unlocked ? 'change-master' : 'recover' });
  }
});

test('not-set-up drops severOffer too (a fresh-adopted profile is by definition set up)', () => {
  const view = selectVaultView({
    setUp: false,
    unlocked: false,
    severOffer: { route: 'recover' }
  });
  assert.equal(view.severOffer, null);
});

test('severOffer is normalized: malformed/absent → null; only the two valid route literals are admitted', () => {
  const base = { setUp: true, unlocked: true, vaults: rows };
  assert.equal(selectVaultView(base).severOffer, null);
  assert.equal(selectVaultView({ ...base, severOffer: 'recover' }).severOffer, null, 'a bare string is not an object');
  assert.equal(selectVaultView({ ...base, severOffer: [] }).severOffer, null, 'an array is not admitted');
  assert.equal(selectVaultView({ ...base, severOffer: { route: 'bogus' } }).severOffer, null, 'an invalid route');
  assert.deepEqual(selectVaultView({ ...base, severOffer: { route: 'change-master' } }).severOffer, {
    route: 'change-master'
  });
  assert.deepEqual(selectVaultView({ ...base, severOffer: { route: 'recover' } }).severOffer, { route: 'recover' });
});

// ---------------------------------------------------------------------------
// M18 F2 L4 (flight DD1/DD6; R4/R8 — the lock-state matrix at the page-model
// level, per design-review M4: vault.js has no DOM harness, so DOM placement /
// copy pins are leg 5's behavior test; the MODEL half is pinned here).
// ---------------------------------------------------------------------------

test('R8 matrix: the compromise report rides BOTH the locked and unlocked views (the card renders wherever the page lands)', () => {
  const report = { admin: true, vaultIds: ['global', 'personal'] };
  for (const unlocked of [true, false]) {
    const view = selectVaultView({ setUp: true, unlocked, vaults: rows, compromiseReport: report });
    assert.equal(view.mode, unlocked ? 'unlocked' : 'locked');
    assert.deepEqual(view.compromiseReport, report, `report carried while unlocked=${unlocked}`);
  }
});

test('R4 matrix: adminProvisioned is carried in BOTH lock states (strict === true), and false when absent', () => {
  for (const unlocked of [true, false]) {
    assert.equal(selectVaultView({ setUp: true, unlocked, adminProvisioned: true }).adminProvisioned, true);
    assert.equal(selectVaultView({ setUp: true, unlocked }).adminProvisioned, false);
    assert.equal(selectVaultView({ setUp: true, unlocked, adminProvisioned: 1 }).adminProvisioned, false);
  }
});

test('not-set-up drops both fields (a rotated profile is by definition set up)', () => {
  const view = selectVaultView({
    setUp: false,
    unlocked: false,
    adminProvisioned: true,
    compromiseReport: { admin: true, vaultIds: ['x'] }
  });
  assert.equal(view.adminProvisioned, false);
  assert.equal(view.compromiseReport, null);
});

test('the compromise report is normalized: malformed → null; vaultIds keeps non-empty strings only; admin is strict boolean', () => {
  const base = { setUp: true, unlocked: true, vaults: rows };
  assert.equal(selectVaultView({ ...base, compromiseReport: 'rotated' }).compromiseReport, null);
  assert.equal(selectVaultView({ ...base, compromiseReport: ['x'] }).compromiseReport, null);
  assert.deepEqual(selectVaultView({ ...base, compromiseReport: {} }).compromiseReport, {
    admin: false,
    vaultIds: []
  });
  assert.deepEqual(
    selectVaultView({
      ...base,
      compromiseReport: { admin: 1, vaultIds: ['global', 7, null, '', 'work'] }
    }).compromiseReport,
    { admin: false, vaultIds: ['global', 'work'] }
  );
});

// ---------------------------------------------------------------------------
// compromiseCardRows — the "Everything rotated" card's revoked-keys row model,
// extracted after behavior-test run 2026-09-02-02-22-01 (checkpoint 7). Leg 4
// had reassigned the card's DOM pins to that behavior test, leaving NO unit
// layer over the report → rendered-rows mapping; these pins close that gap.
// ---------------------------------------------------------------------------

test('compromiseCardRows: rotation WITH revocations — admin row first ("Admin key — Revoked"), then one row per revoked vault by display label, `global` handled', () => {
  const vaults = [
    { vaultId: 'global', label: 'Global' },
    { vaultId: 'personal', label: 'Personal' }
  ];
  assert.deepEqual(compromiseCardRows({ admin: true, vaultIds: ['global', 'personal'] }, vaults), [
    { label: 'Admin key', hint: '— Revoked' },
    { label: 'Global', hint: '— Revoked' },
    { label: 'Personal', hint: '— Revoked' }
  ]);
  // A revoked id with no matching vault row (e.g. an unregistered on-disk vault
  // swept by the registry∪disk union) falls back to the raw id.
  assert.deepEqual(compromiseCardRows({ admin: false, vaultIds: ['orphan'] }, vaults), [
    { label: 'orphan', hint: '— Revoked' }
  ]);
});

test('compromiseCardRows: rotation with NOTHING to revoke → zero rows (the card still renders — an empty list is the CORRECT state after a repeat rotation)', () => {
  const vaults = [{ vaultId: 'global', label: 'Global' }];
  assert.deepEqual(compromiseCardRows({ admin: false, vaultIds: [] }, vaults), []);
  // Defensive halves: a malformed report or missing vault rows never throw.
  assert.deepEqual(compromiseCardRows(null, vaults), []);
  assert.deepEqual(compromiseCardRows({ admin: 1, vaultIds: 'global' }, vaults), []);
  assert.deepEqual(compromiseCardRows({ admin: true, vaultIds: ['global'] }, undefined), [
    { label: 'Admin key', hint: '— Revoked' },
    { label: 'global', hint: '— Revoked' }
  ]);
});

test('vault rows are normalized to { vaultId, label }; a missing label falls back to the id', () => {
  const view = selectVaultView({
    setUp: true,
    unlocked: true,
    vaults: [
      { vaultId: 'global', label: 'Global' },
      { vaultId: 'work' }, // no label
      { label: 'orphan' }, // no vaultId → dropped
      null // dropped
    ]
  });
  assert.deepEqual(view.vaults, [
    { vaultId: 'global', label: 'Global' },
    { vaultId: 'work', label: 'work' }
  ]);
});

// ── vaultNavEntries: the two-level master-detail left-nav entry model (M12 F5 HAT batch) ──

const jars = [
  { id: 'personal', name: 'Personal', color: '#4caf50' },
  { id: 'work', name: 'Work', color: '#2196f3' }
];

// Convenience: the Vaults group's children (the per-vault entries).
const childrenOf = (entries) => entries.find((e) => e.kind === 'group').children;

test('nav entries = a Settings entry then a Vaults group whose children are the vaults, in order', () => {
  const entries = vaultNavEntries(
    [
      { vaultId: 'global', label: 'Global' },
      { vaultId: 'personal', label: 'Personal' },
      { vaultId: 'work', label: 'Work' }
    ],
    jars
  );
  // Two top-level entries: Settings, then the Vaults group.
  assert.deepEqual(
    entries.map((e) => [e.id, e.kind]),
    [
      [SETTINGS_ID, 'settings'],
      [VAULTS_ID, 'group']
    ]
  );
  assert.equal(entries[1].label, 'Vaults');
  // Each vault is an indented child of the Vaults group, in order.
  assert.deepEqual(
    childrenOf(entries).map((e) => [e.id, e.kind]),
    [
      ['global', 'global'],
      ['personal', 'jar'],
      ['work', 'jar']
    ]
  );
});

test('the global vault (not a persistent jar) is kind "global"; jars are kind "jar" with their color', () => {
  const entries = vaultNavEntries(
    [
      { vaultId: 'global', label: 'Global', count: 2 },
      { vaultId: 'personal', label: 'Personal', count: 5 }
    ],
    jars
  );
  const children = childrenOf(entries);
  const global = children.find((e) => e.id === 'global');
  const personal = children.find((e) => e.id === 'personal');
  assert.equal(global.kind, 'global');
  assert.equal(global.color, undefined); // globe, no dot
  assert.equal(global.count, 2);
  assert.equal(personal.kind, 'jar');
  assert.equal(personal.color, '#4caf50');
  assert.equal(personal.count, 5);
});

test('a jar with no color joins to null (the controller applies the fallback)', () => {
  const entries = vaultNavEntries(
    [{ vaultId: 'work', label: 'Work' }],
    [{ id: 'work', name: 'Work' }] // no color
  );
  const children = childrenOf(entries);
  assert.equal(children[0].kind, 'jar');
  assert.equal(children[0].color, null);
});

test('empty vaults → Settings + an empty Vaults group; malformed inputs degrade safely', () => {
  assert.deepEqual(
    vaultNavEntries([], jars).map((e) => e.id),
    [SETTINGS_ID, VAULTS_ID]
  );
  assert.deepEqual(childrenOf(vaultNavEntries([], jars)), []);
  assert.deepEqual(
    vaultNavEntries(undefined, undefined).map((e) => e.id),
    [SETTINGS_ID, VAULTS_ID]
  );
  assert.deepEqual(childrenOf(vaultNavEntries(undefined, undefined)), []);
  // a vault row missing its id is dropped from the group's children
  const entries = vaultNavEntries([{ label: 'orphan' }, { vaultId: 'work', label: 'Work' }], jars);
  assert.deepEqual(
    childrenOf(entries).map((e) => e.id),
    ['work']
  );
});

// ── restoreDestinationOptions: the mapping modal's jar-row "existing" destinations
// (M18 F3 L4, HAT fix 8) ──

test('restoreDestinationOptions: one option per jar, labeled by vault presence — including a vault-LESS jar (the fresh-adopt fix)', () => {
  const { options } = restoreDestinationOptions(
    jars,
    { personal: { hasVault: true, count: 3 } } // work: no presence entry at all
  );
  assert.deepEqual(options, [
    { vaultId: 'personal', label: 'Personal — 3 secrets' },
    { vaultId: 'work', label: 'Work — no secrets yet' }
  ]);
});

test('restoreDestinationOptions: a hasVault jar with no known count still offers a usable label', () => {
  const { options } = restoreDestinationOptions([{ id: 'work', name: 'Work' }], { work: { hasVault: true } });
  assert.deepEqual(options, [{ vaultId: 'work', label: 'Work — has secrets' }]);
});

test('restoreDestinationOptions: singular "secret" at count 1', () => {
  const { options } = restoreDestinationOptions([{ id: 'work', name: 'Work' }], { work: { hasVault: true, count: 1 } });
  assert.equal(options[0].label, 'Work — 1 secret');
});

test('restoreDestinationOptions: rerun-recovery match is case-insensitive/trimmed and works against a VAULT-LESS destination', () => {
  const { matched } = restoreDestinationOptions(jars, {}, '  personal  ');
  assert.deepEqual(matched, { vaultId: 'personal', label: 'Personal — no secrets yet' });
});

test('restoreDestinationOptions: no name given, or no match found, → matched is undefined', () => {
  assert.equal(restoreDestinationOptions(jars, {}).matched, undefined);
  assert.equal(restoreDestinationOptions(jars, {}, 'nonexistent').matched, undefined);
});

test('restoreDestinationOptions: empty/malformed jar list → empty options, no throw, no match', () => {
  assert.deepEqual(restoreDestinationOptions([], {}, 'Personal'), { options: [], matched: undefined });
  assert.deepEqual(restoreDestinationOptions(undefined, undefined, 'Personal'), { options: [], matched: undefined });
  assert.deepEqual(restoreDestinationOptions([null, { name: 'no id' }, { id: 'work', name: 'Work' }], {}).options, [
    { vaultId: 'work', label: 'Work — no secrets yet' }
  ]);
});

test('squawk 0064: not-set-up mode (selectVaultView vaults: []) with pre-existing vault-less jars — restoreDestinationOptions still offers them as existing destinations, and the name-match prefill picks the matching container', () => {
  // M18 F3 HAT fix 8's regression case: selectVaultView drops the (empty) vault
  // list entirely in not-set-up mode, so restoreDestinationOptions must be fed
  // jarRows independently rather than deriving its options from view.vaults —
  // otherwise a fresh-adopt profile (no vault ever created) would have nothing
  // to offer and every bundle row would be forced onto "Create a new jar",
  // colliding with the same-named seeded container.
  const view = selectVaultView({ setUp: false, unlocked: false, vaults: [] });
  assert.equal(view.mode, 'not-set-up');
  assert.deepEqual(view.vaults, []);

  // jarRows (pre-existing, vault-less containers) come from a separate read —
  // restoreDestinationOptions is called with them directly, not view.vaults.
  const { options, matched } = restoreDestinationOptions(jars, {}, 'Work');
  assert.deepEqual(options, [
    { vaultId: 'personal', label: 'Personal — no secrets yet' },
    { vaultId: 'work', label: 'Work — no secrets yet' }
  ]);
  assert.deepEqual(matched, { vaultId: 'work', label: 'Work — no secrets yet' });
});

// ---------------------------------------------------------------------------
// restoreOutcomeLines — the restore completion modal's per-vault outcome
// display lines (M18 F3 L4, HAT fix 11; RE-KEYED M18 F3 L5 to close the
// bundle identity leak). Results are keyed by the bundle's opaque
// `entryHandle`; `labels` (the mapping step's decrypted per-entry identities)
// is the second argument the join resolves display NAMES from — an
// entryHandle itself is never rendered. Operator feedback (unchanged):
// a merge commit's completion surface didn't say whether items actually
// landed or deduped — this closes that by rendering merge detail whenever a
// mergeReport rides the outcome.
// ---------------------------------------------------------------------------

const JAR_LABEL = (entryHandle, name) => ({ entryHandle, identity: { kind: 'jar', name } });
const GLOBAL_LABEL = (entryHandle) => ({ entryHandle, identity: { kind: 'global' } });

test('restoreOutcomeLines: landed with no mergeReport → plain "restored", name resolved via labels', () => {
  const labels = [JAR_LABEL('h1', 'personal')];
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'h1', outcome: 'landed', destination: 'personal-1' }], labels), [
    { entryHandle: 'h1', text: 'personal → personal-1: restored' }
  ]);
});

test('restoreOutcomeLines: landed with a mergeReport, zero conflict copies → no trailing copies clause (the operator’s exact dedup case)', () => {
  const labels = [JAR_LABEL('h1', 'personal')];
  const lines = restoreOutcomeLines(
    [
      {
        entryHandle: 'h1',
        outcome: 'landed',
        destination: 'personal-1',
        mergeReport: { imported: 0, skippedIdentical: 5, conflictCopies: 0 }
      }
    ],
    labels
  );
  assert.deepEqual(lines, [{ entryHandle: 'h1', text: 'personal → personal-1: merged — 0 new, 5 already present' }]);
});

test('restoreOutcomeLines: landed with a mergeReport AND conflict copies → trailing copies clause appended', () => {
  const labels = [JAR_LABEL('h1', 'personal')];
  const lines = restoreOutcomeLines(
    [
      {
        entryHandle: 'h1',
        outcome: 'landed',
        destination: 'personal-1',
        mergeReport: { imported: 2, skippedIdentical: 3, conflictCopies: 1 }
      }
    ],
    labels
  );
  assert.deepEqual(lines, [
    { entryHandle: 'h1', text: 'personal → personal-1: merged — 2 new, 3 already present, 1 kept as copies' }
  ]);
});

test('restoreOutcomeLines: skipped → no destination in the line', () => {
  const labels = [JAR_LABEL('h1', 'work')];
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'h1', outcome: 'skipped' }], labels), [
    { entryHandle: 'h1', text: 'work: skipped' }
  ]);
});

test('restoreOutcomeLines: collision-refused → destination shown, guidance to choose Replace or Merge', () => {
  const labels = [JAR_LABEL('h1', 'personal')];
  assert.deepEqual(
    restoreOutcomeLines([{ entryHandle: 'h1', outcome: 'collision-refused', destination: 'personal-1' }], labels),
    [
      {
        entryHandle: 'h1',
        text: 'personal → personal-1: not restored (a vault already exists; choose Replace or Merge)'
      }
    ]
  );
});

test('restoreOutcomeLines: failed → no destination in the line; the global identity resolves to "Global"', () => {
  const labels = [GLOBAL_LABEL('h1')];
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'h1', outcome: 'failed' }], labels), [
    { entryHandle: 'h1', text: 'Global: failed' }
  ]);
});

test('restoreOutcomeLines: multiple results render in order, one line each', () => {
  const labels = [JAR_LABEL('ha', 'a'), JAR_LABEL('hb', 'b'), JAR_LABEL('hc', 'c')];
  const lines = restoreOutcomeLines(
    [
      { entryHandle: 'ha', outcome: 'landed', destination: 'a-1' },
      { entryHandle: 'hb', outcome: 'skipped' },
      { entryHandle: 'hc', outcome: 'failed' }
    ],
    labels
  );
  assert.deepEqual(
    lines.map((l) => l.entryHandle),
    ['ha', 'hb', 'hc']
  );
});

test('restoreOutcomeLines: malformed input degrades safely — non-array, non-object entries, missing entryHandle all drop/no-throw', () => {
  assert.deepEqual(restoreOutcomeLines(undefined), []);
  assert.deepEqual(restoreOutcomeLines([]), []);
  assert.deepEqual(restoreOutcomeLines([null, 'nope', {}, { entryHandle: '' }, { outcome: 'landed' }]), []);
});

test('restoreOutcomeLines: an entryHandle with NO matching label falls back to "a vault" — never the raw entryHandle', () => {
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'orphan', outcome: 'skipped' }], []), [
    { entryHandle: 'orphan', text: 'a vault: skipped' }
  ]);
  // Malformed/missing labels array degrades the same way — never throws.
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'orphan', outcome: 'skipped' }]), [
    { entryHandle: 'orphan', text: 'a vault: skipped' }
  ]);
});

test('restoreOutcomeLines: mergeReport with non-numeric/missing fields coerces to 0, never NaN/undefined in the text', () => {
  const labels = [JAR_LABEL('h1', 'personal')];
  const lines = restoreOutcomeLines(
    [{ entryHandle: 'h1', outcome: 'landed', destination: 'personal-1', mergeReport: {} }],
    labels
  );
  assert.deepEqual(lines, [{ entryHandle: 'h1', text: 'personal → personal-1: merged — 0 new, 0 already present' }]);
});

test('restoreOutcomeLines: an unrecognized outcome falls back to echoing the raw value', () => {
  const labels = [JAR_LABEL('h1', 'x')];
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'h1', outcome: 'weird' }], labels), [
    { entryHandle: 'h1', text: 'x: weird' }
  ]);
  assert.deepEqual(restoreOutcomeLines([{ entryHandle: 'h1', outcome: 123 }], labels), [
    { entryHandle: 'h1', text: 'x: unknown' }
  ]);
});

// ── browserImportDestinationOptions (M19 F1 Leg 2 / DD9) ────────────────────

test('browserImportDestinationOptions: Global always leads, labeled from globalPresence; jar options come verbatim from restoreDestinationOptions', () => {
  const options = browserImportDestinationOptions(
    [{ id: 'work', name: 'Work' }],
    { work: { hasVault: true, count: 2 } },
    { hasVault: true, count: 5 }
  );
  assert.deepEqual(options, [
    { vaultId: 'global', label: 'Global — 5 secrets' },
    { vaultId: 'work', label: 'Work — 2 secrets' }
  ]);
});

test('browserImportDestinationOptions: globalPresence hasVault false → "no secrets yet"; a hasVault vault with no count → "has secrets"', () => {
  assert.equal(
    browserImportDestinationOptions([], {}, { hasVault: false }).find((o) => o.vaultId === 'global').label,
    'Global — no secrets yet'
  );
  assert.equal(
    browserImportDestinationOptions([], {}, { hasVault: true }).find((o) => o.vaultId === 'global').label,
    'Global — has secrets'
  );
});

test('browserImportDestinationOptions: singular "secret" at count 1', () => {
  assert.equal(
    browserImportDestinationOptions([], {}, { hasVault: true, count: 1 }).find((o) => o.vaultId === 'global').label,
    'Global — 1 secret'
  );
});

test('browserImportDestinationOptions: malformed/absent globalPresence degrades to "no secrets yet", never throws', () => {
  assert.equal(
    browserImportDestinationOptions([], {}).find((o) => o.vaultId === 'global').label,
    'Global — no secrets yet'
  );
  assert.equal(
    browserImportDestinationOptions([], {}, null).find((o) => o.vaultId === 'global').label,
    'Global — no secrets yet'
  );
  assert.equal(
    browserImportDestinationOptions([], {}, { hasVault: true, count: -1 }).find((o) => o.vaultId === 'global').label,
    'Global — has secrets'
  );
});

// ── browserImportSkipLines (M19 F1 Leg 2 / DD8, DD11) ────────────────────────

test('browserImportSkipLines: every DD8 reason code gets its fixed label', () => {
  const lines = browserImportSkipLines([
    { line: 2, reason: 'malformed' },
    { line: 3, reason: 'field-too-long' },
    { line: 4, reason: 'malformed-url' },
    { line: 5, reason: 'no-password' }
  ]);
  assert.deepEqual(lines, [
    { line: 2, text: 'malformed row' },
    { line: 3, text: 'a field is too long' },
    { line: 4, text: 'unusable URL' },
    { line: 5, text: 'no stored password' }
  ]);
});

test('browserImportSkipLines: non-web-origin renders the captured scheme, never the raw "null" origin string', () => {
  assert.deepEqual(browserImportSkipLines([{ line: 9, reason: 'non-web-origin', scheme: 'android' }]), [
    { line: 9, text: 'non-web origin (android://)' }
  ]);
});

test('browserImportSkipLines: an unknown reason code echoes the raw value; malformed entries drop, never throw', () => {
  assert.deepEqual(browserImportSkipLines([{ line: 1, reason: 'blocklist' }]), [{ line: 1, text: 'blocklist' }]);
  assert.deepEqual(browserImportSkipLines(undefined), []);
  assert.deepEqual(browserImportSkipLines([null, 'nope', {}, { line: 'x', reason: 'malformed' }]), []);
});

// ── browserImportOutcomeLines (M19 F1 Leg 2 / DD11) ──────────────────────────

test('browserImportOutcomeLines: imported always renders even at zero; every other line omitted at zero', () => {
  assert.deepEqual(
    browserImportOutcomeLines({
      imported: 0,
      duplicate: 0,
      changed: 0,
      failed: 0,
      unmappable: { total: 0, byReason: {} }
    }),
    ['0 imported']
  );
});

test('browserImportOutcomeLines: a full set of non-zero outcomes renders every line in order, with the unmappable breakdown by reason', () => {
  const lines = browserImportOutcomeLines({
    imported: 3,
    duplicate: 2,
    changed: 1,
    failed: 1,
    unmappable: { total: 3, byReason: { malformed: 2, 'non-web-origin': 1 } }
  });
  assert.deepEqual(lines, [
    '3 imported',
    '2 already present (skipped)',
    '1 changed — kept as copies',
    '3 could not be imported: 2 malformed row, 1 non-web origin',
    '1 failed'
  ]);
});

test('browserImportOutcomeLines: malformed/missing counts coerce to 0, never NaN/undefined — degrades to "0 imported" alone', () => {
  assert.deepEqual(browserImportOutcomeLines(undefined), ['0 imported']);
  assert.deepEqual(browserImportOutcomeLines({}), ['0 imported']);
  assert.deepEqual(browserImportOutcomeLines({ imported: 'nope', duplicate: -5, unmappable: null }), ['0 imported']);
});
