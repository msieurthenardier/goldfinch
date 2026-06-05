'use strict';

// Cookie jars / container identities. Each container is an isolated Electron
// session partition (its own cookies, storage, cache) — and, because the farble
// seed is keyed per session, its own fingerprint persona too.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = [
  { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' },
  { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' },
  { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' },
  { id: 'banking', name: 'Banking', color: '#f5c518', partition: 'persist:container:banking' }
];

let containers = DEFAULTS.map((c) => ({ ...c }));
let storePath = null;

function load() {
  try {
    storePath = path.join(app.getPath('userData'), 'containers.json');
    if (fs.existsSync(storePath)) {
      const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (Array.isArray(saved) && saved.length) containers = saved;
    }
  } catch { /* defaults */ }
  return containers;
}

function save() {
  try { if (storePath) fs.writeFileSync(storePath, JSON.stringify(containers, null, 2)); } catch { /* ignore */ }
}

function list() { return containers; }

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'jar';
}

function add(name, color) {
  const base = slug(name);
  let id = base;
  let n = 1;
  while (containers.some((c) => c.id === id)) id = `${base}-${n++}`;
  const container = { id, name: String(name).slice(0, 24) || 'Jar', color: color || '#b06ef5', partition: `persist:container:${id}` };
  containers.push(container);
  save();
  return container;
}

module.exports = { load, list, add };
