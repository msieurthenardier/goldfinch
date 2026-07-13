'use strict';

// Cookie jars / container identities. Each container is an isolated Electron
// session partition (its own cookies, storage, cache) — and, because the farble
// seed is keyed per session, its own fingerprint persona too.
//
// v2 model (M06 Flight 1 / DD1, DD2, DD8). On-disk shape:
//   { version: 2, defaultId: string|null, containers: [ { id, name, color, partition } ] }
//
// - `defaultId` is a TOP-LEVEL pointer, so "exactly one default" is structural.
//   Invariant (DD2): defaultId MUST reference an existing entry whenever any
//   persistent jar exists; `null` means "Burner is the default" and is valid ONLY
//   while `containers` is empty. Empty is a VALID persisted state — no reseed.
// - Ids and partitions are IMMUTABLE (DD5): rename touches name/color only.
//   `persist:goldfinch` is valid only on id `default` (the legacy jar).
// - The Burner is NEVER a store entry (DD4, src/shared/burner.js); its namespace
//   plus privileged identity ids are reserved and remapped, never dropped.
// - Durability follows downloads-store (DD8): atomic tmp+rename save, version
//   envelope, per-entry validator-drop, load never throws.
// - Load migration (DD3), three shapes: (a) a v2 envelope is validated +
//   repaired in place; (b) a v1 bare array is validated under the v2 rules and
//   rewritten as a v2 envelope (defaultId `default` if that id survives, else
//   the first entry; zero survivors fall through to (c)); (c) no file /
//   corrupt / unknown shape probes `userData/Partitions/goldfinch` (existence
//   only, never contents) — present means the app has run before → legacy
//   four-jar seed, absent means a true first run → fresh seed. Both (c)
//   branches persist synchronously inside load(): main.js pre-warms
//   `persist:goldfinch` on every launch, so an unsaved fresh seed would
//   re-probe as legacy on launch #2.
//   A known envelope shape with an unknown version is kept in memory but never
//   rewritten by load, so a later compatible release can recover it.
//
// This module is ELECTRON-FREE: the userData path is injected at load(userDataPath),
// like settings-store/downloads-store, so the unit suite needs no electron stub.

const fs = require('fs');
const path = require('path');

// Injection-safe color validator — extracted to src/shared/safe-color.js (M05
// Flight 8, Leg 3) so the menu-overlay sheet validates dot colors against the SAME
// domain. Re-exported below (not moved) — consumers keep requiring it from here.
const { isSafeColor } = require('../shared/safe-color');
const { BURNER } = require('../shared/burner');

const FILE_NAME = 'containers.json';
const SCHEMA_VERSION = 2;
const FALLBACK_COLOR = '#b06ef5';

// New-install seed (v2): Personal (default) + Work.
const FRESH_SEED = [
  { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' },
  { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' }
];

// Legacy-install seed (DD3c): the four-jar set a pre-v2 profile shipped with,
// used by load() when there is no readable store but the base partition dir
// proves the app has run before.
const LEGACY_DEFAULTS = [
  { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' },
  { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' },
  { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' },
  { id: 'banking', name: 'Banking', color: '#f5c518', partition: 'persist:container:banking' }
];

let containers = FRESH_SEED.map((c) => ({ ...c }));
let defaultId = FRESH_SEED[0].id;
let storePath = null;

// Reserved identities (DD4): burner-tab ids are minted as `burner-<n>`, while
// admin/internal/default have privileged or built-in meanings outside user jars.
function isReservedId(id) {
  return (
    id === 'burner' ||
    id.startsWith('burner-') ||
    id === 'admin' ||
    id === 'internal' ||
    id === 'default'
  );
}

// Same validation rules as add()/validateContainers — shared so rename() cannot
// drift from the mint-time discipline.
function cleanName(name) {
  return String(name).slice(0, 24) || 'Jar';
}

function cleanColor(color) {
  return isSafeColor(color) ? color : FALLBACK_COLOR;
}

function validateContainers(saved) {
  if (!Array.isArray(saved)) return [];

  // Pre-scan the raw (non-reserved) id claims so a reserved-id remap never lands
  // on an id a later literal entry holds — remap, never drop (DD4): with input
  // [burner, jar-burner] the remapped entry must become jar-burner-1, not evict
  // (or be evicted by) the literal jar-burner.
  const claimedIds = new Set();
  for (const entry of saved) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.id !== 'string' || !entry.id || isReservedId(entry.id)) continue;
    claimedIds.add(entry.id);
  }

  const seenId = new Set();
  const seenPartition = new Set();
  const kept = [];

  for (const entry of saved) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { partition, name, color } = entry;
    let id = entry.id;
    if (typeof id !== 'string' || !id) continue;
    if (typeof partition !== 'string' || !/^persist:/.test(partition)) continue;
    // The directly-seeded legacy default is the one legitimate use of this
    // reserved id; add()/slug() can never mint its persist:goldfinch partition.
    const legacyDefault = id === 'default' && partition === 'persist:goldfinch';
    // Reserve the default session: a non-default entry must not alias persist:goldfinch
    if (id !== 'default' && partition === 'persist:goldfinch') continue;
    // Reserved-id remap (DD4) BEFORE the dedup check: entries move to a `jar-`
    // prefixed id via the same collision-suffix loop as add(). Partition and
    // name are untouched, so the entry's data survives under its new id.
    if (isReservedId(id) && !legacyDefault) {
      const base = `jar-${id}`;
      let remapped = base;
      let n = 1;
      while (seenId.has(remapped) || claimedIds.has(remapped)) remapped = `${base}-${n++}`;
      id = remapped;
    }
    // De-dupe by id and by partition (first occurrence wins for both)
    if (seenId.has(id) || seenPartition.has(partition)) continue;
    seenId.add(id);
    seenPartition.add(partition);
    // Build a new object field-by-field — never spread the parsed entry
    kept.push({
      id,
      name: cleanName(name),
      color: cleanColor(color),
      partition
    });
  }

  return kept;
}

// DD2 repair: keep a candidate that references a surviving jar; otherwise the
// first jar in list order; null only when no jars remain.
function repairDefaultId(list, candidate) {
  if (typeof candidate === 'string' && list.some((c) => c.id === candidate)) return candidate;
  return list.length ? list[0].id : null;
}

function load(userDataPath) {
  try {
    const file = path.join(userDataPath, FILE_NAME);
    // Persistence is unconditional post-migration: every shape below either keeps
    // the file as-is (v2 / unknown envelope) or rewrites it (v1 / seed), so
    // storePath is assigned once, before the dispatch.
    storePath = file;
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* missing file or unparseable JSON — `saved` stays undefined → seed path (c) */
    }
    // (a) v2 envelope: validate + repair, never rewritten by load.
    if (
      saved !== null &&
      typeof saved === 'object' &&
      !Array.isArray(saved) &&
      saved.version === SCHEMA_VERSION &&
      Array.isArray(saved.containers)
    ) {
      containers = validateContainers(saved.containers);
      // Repair runs AFTER validation, so a defaultId pointing at a dropped entry
      // lands on the first surviving jar. Empty list → null (Burner is default) —
      // empty is a VALID persisted state, never reseeded (DD2).
      defaultId = repairDefaultId(containers, saved.defaultId);
      return containers;
    }
    // (b) v1 bare array: validate under the v2 rules (reserved-namespace remap
    // included) and rewrite as a v2 envelope — once; the rewritten file parses
    // as (a) on every later load. Zero survivors mean there is nothing to
    // preserve → fall through to (c).
    if (Array.isArray(saved)) {
      const validated = validateContainers(saved);
      if (validated.length) {
        containers = validated;
        defaultId = repairDefaultId(validated, 'default');
        save();
        return containers;
      }
    }
    // A readable envelope with an unknown version is still user data. Keep a
    // best-effort in-memory view, but never rewrite it during load — a future
    // compatible release can then recover the original envelope unchanged.
    if (saved !== null && typeof saved === 'object' && !Array.isArray(saved) && Array.isArray(saved.containers)) {
      containers = validateContainers(saved.containers);
      defaultId = repairDefaultId(containers, saved.defaultId);
      return containers;
    }
    // (c) no readable store (missing file, corrupt JSON, unknown shape):
    // probe the legacy base partition — existence only, never contents (DD3).
    // Present → the app has run before → legacy four-jar seed; absent → true
    // first run → fresh seed. Persist synchronously: main.js pre-warms
    // persist:goldfinch on every launch, so an unsaved fresh seed would re-probe
    // as legacy on launch #2 (DD3, load-bearing).
    const legacy = fs.existsSync(path.join(userDataPath, 'Partitions', 'goldfinch'));
    containers = (legacy ? LEGACY_DEFAULTS : FRESH_SEED).map((c) => ({ ...c }));
    defaultId = legacy ? 'default' : 'personal';
    save();
    return containers;
  } catch {
    /* fall through — load never throws */
  }
  // Unreachable by any on-disk shape (all handled above); keeps the never-throws
  // contract for faults outside them (e.g. a non-string userDataPath).
  containers = FRESH_SEED.map((c) => ({ ...c }));
  defaultId = containers[0].id;
  return containers;
}

// Atomic write — temp file beside the target (same fs → atomic rename). Fail-soft:
// jar mutations must not crash the app on a bad disk. The !storePath guard is
// load-bearing: add() before load() is an exercised path — an unguarded
// `storePath + '.tmp'` would write a literal `null.tmp` in cwd.
function save() {
  try {
    if (!storePath) return;
    // Unlike settings/downloads (which first save on user action, long after the
    // profile dir exists), jars persists synchronously INSIDE load() (DD3c) — and
    // on a true first run the dev-redirected userData dir may not exist yet
    // (Electron creates it lazily). Without this, the seed write ENOENTs into the
    // fail-soft catch, nothing persists, and the pre-warm makes launch #2 re-probe
    // the fresh install as legacy (the exact DD3 bug the sync persist prevents).
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tmp = storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: SCHEMA_VERSION, defaultId, containers }, null, 2));
    fs.renameSync(tmp, storePath);
  } catch {
    /* ignore */
  }
}

// Live array — main.js consumers (jars-list IPC, key-status join) depend on it.
// No isDefault field on entries (DD7): default info is getDefault()'s job.
function list() {
  return containers;
}

function slug(name) {
  const base =
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'jar';
  // Mint-time half of the reserved-id rule (DD4): a reserved slug moves to the
  // `jar-` prefix (display name untouched).
  return isReservedId(base) ? `jar-${base}` : base;
}

function add(name, color) {
  const base = slug(name);
  let id = base;
  let n = 1;
  while (containers.some((c) => c.id === id)) id = `${base}-${n++}`;
  const container = {
    id,
    name: cleanName(name),
    color: cleanColor(color),
    partition: `persist:container:${id}`
  };
  containers.push(container);
  // DD2: null-with-jars-present is forbidden — the first jar added into an empty
  // store becomes the default automatically.
  if (defaultId === null) defaultId = container.id;
  save();
  return container;
}

// Rename is COSMETIC (DD5): id and partition are immutable; only provided fields
// change, validated by the same rules as add(). Returns the updated container, or
// null for an unknown id (no throw).
/** @param {string} id @param {{ name?: any, color?: any }} [patch] */
function rename(id, { name, color } = {}) {
  const container = containers.find((c) => c.id === id);
  if (!container) return null;
  if (name !== undefined) container.name = cleanName(name);
  if (color !== undefined) container.color = cleanColor(color);
  save();
  return container;
}

// Deletes the entry only — session side-effects (partition wipe, seed reroll, key
// revoke) are the IPC handler layer's job (DD6). If the removed jar held the
// default flag it moves to the first remaining jar, or null when none remain.
// Returns the removed container (the IPC layer needs its partition for the wipe),
// or null for an unknown id — same container-or-null contract as rename().
function remove(id) {
  const idx = containers.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const [removed] = containers.splice(idx, 1);
  if (defaultId === removed.id) defaultId = repairDefaultId(containers, null);
  save();
  return removed;
}

// Returns boolean: unknown id or null-while-jars-exist → false (DD2 keeps the
// invariant strict; Flight 3 can relax explicit Burner-as-default deliberately).
// Setting the current holder again succeeds and still persists (cheap, simpler
// contract); setDefault(null) while already empty is an idempotent no-op.
function setDefault(id) {
  if (id === null) {
    if (containers.length) return false;
    defaultId = null;
    save();
    return true;
  }
  if (!containers.some((c) => c.id === id)) return false;
  defaultId = id;
  save();
  return true;
}

// The effective default: the flagged jar, or the Burner identity while the store
// is empty (defaultId === null).
function getDefault() {
  if (defaultId === null) return BURNER;
  return containers.find((c) => c.id === defaultId) || BURNER;
}

module.exports = {
  load,
  list,
  add,
  rename,
  remove,
  setDefault,
  getDefault,
  validateContainers,
  isSafeColor
};
