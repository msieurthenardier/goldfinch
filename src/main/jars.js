'use strict';

// Cookie jars / container identities. Each container is an isolated Electron
// session partition (its own cookies, storage, cache) — and, because the farble
// seed is keyed per session, its own fingerprint persona too.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Injection-safe color validator — extracted to src/shared/safe-color.js (M05
// Flight 8, Leg 3) so the menu-overlay sheet validates dot colors against the SAME
// domain. Re-exported below (not moved) — consumers keep requiring it from here.
const { isSafeColor } = require('../shared/safe-color');

const DEFAULTS = [
  { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' },
  { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' },
  { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' },
  { id: 'banking', name: 'Banking', color: '#f5c518', partition: 'persist:container:banking' }
];

let containers = DEFAULTS.map((c) => ({ ...c }));
let storePath = null;

function validateContainers(saved) {
  if (!Array.isArray(saved)) return [];

  const seenId = new Set();
  const seenPartition = new Set();
  const kept = [];

  for (const entry of saved) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { id, partition, name, color } = entry;
    if (typeof id !== 'string' || !id) continue;
    if (typeof partition !== 'string' || !/^persist:/.test(partition)) continue;
    // Reserve the default session: a non-default entry must not alias persist:goldfinch
    if (id !== 'default' && partition === 'persist:goldfinch') continue;
    // De-dupe by id and by partition (first occurrence wins for both)
    if (seenId.has(id) || seenPartition.has(partition)) continue;
    seenId.add(id);
    seenPartition.add(partition);
    // Build a new object field-by-field — never spread the parsed entry
    kept.push({
      id,
      name: String(name).slice(0, 24) || 'Jar',
      color: isSafeColor(color) ? color : '#b06ef5',
      partition
    });
  }

  // Default floor: ensure a valid 'default' entry always exists (prepend so its
  // partition wins any future dedup ordering — canonical persist:goldfinch first).
  if (!kept.some((c) => c.id === 'default')) {
    const def = DEFAULTS.find((c) => c.id === 'default');
    kept.unshift({ ...def });
  }

  return kept;
}

function load() {
  try {
    storePath = path.join(app.getPath('userData'), 'containers.json');
    if (fs.existsSync(storePath)) {
      const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const validated = validateContainers(saved);
      if (validated.length) containers = validated;
    }
  } catch {
    /* defaults */
  }
  return containers;
}

function save() {
  try {
    if (storePath) fs.writeFileSync(storePath, JSON.stringify(containers, null, 2));
  } catch {
    /* ignore */
  }
}

function list() {
  return containers;
}

function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'jar'
  );
}

function add(name, color) {
  const base = slug(name);
  let id = base;
  let n = 1;
  while (containers.some((c) => c.id === id)) id = `${base}-${n++}`;
  const container = {
    id,
    name: String(name).slice(0, 24) || 'Jar',
    color: isSafeColor(color) ? color : '#b06ef5',
    partition: `persist:container:${id}`
  };
  containers.push(container);
  save();
  return container;
}

module.exports = { load, list, add, validateContainers, isSafeColor };
