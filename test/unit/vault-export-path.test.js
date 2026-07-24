'use strict';

// Unit tests for the export-path validator (M12 F5 HAT tail). The vault page's Export modal honors
// a TYPED/PASTED save path, and vaultSaveBundleToFile writes it directly — so validateExportPath
// MUST gate a renderer-supplied path before the write (no write-anywhere primitive). Electron-free;
// exercised against real temp dirs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateExportPath } = require('../../src/main/vault/export-path');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-export-path-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('accepts a .gfvaultbundle path in an existing writable dir → resolved absolute path', () => {
  const dir = tmpDir();
  try {
    const p = path.join(dir, 'vault-global.gfvaultbundle');
    const res = validateExportPath(p);
    assert.deepEqual(res, { ok: true, path: path.resolve(p) });
  } finally { rm(dir); }
});

test('accepts a .json path too (case-insensitive extension)', () => {
  const dir = tmpDir();
  try {
    assert.equal(validateExportPath(path.join(dir, 'x.JSON')).ok, true);
    assert.equal(validateExportPath(path.join(dir, 'x.GfVaultBundle')).ok, true);
  } finally { rm(dir); }
});

test('rejects an empty / non-string path', () => {
  assert.deepEqual(validateExportPath(''), { ok: false, reason: 'empty' });
  assert.deepEqual(validateExportPath('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(validateExportPath(undefined), { ok: false, reason: 'empty' });
  assert.deepEqual(validateExportPath(null), { ok: false, reason: 'empty' });
  assert.deepEqual(validateExportPath(42), { ok: false, reason: 'empty' });
});

test('rejects a disallowed extension (never an arbitrary target)', () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(validateExportPath(path.join(dir, 'passwd')), { ok: false, reason: 'extension' });
    assert.deepEqual(validateExportPath(path.join(dir, 'x.txt')), { ok: false, reason: 'extension' });
    assert.deepEqual(validateExportPath(path.join(dir, '.bashrc')), { ok: false, reason: 'extension' });
  } finally { rm(dir); }
});

test('rejects a path whose parent directory does not exist (traversal into a missing tree)', () => {
  const dir = tmpDir();
  try {
    const p = path.join(dir, 'no', 'such', 'deep', 'x.gfvaultbundle');
    assert.deepEqual(validateExportPath(p), { ok: false, reason: 'no-parent' });
    // A classic traversal string canonicalizes but still lands where the parent is missing.
    const trav = path.join(dir, '..', 'gf-does-not-exist-xyz', 'x.gfvaultbundle');
    assert.deepEqual(validateExportPath(trav), { ok: false, reason: 'no-parent' });
  } finally { rm(dir); }
});

test('rejects when the target itself is an existing directory', () => {
  const dir = tmpDir();
  try {
    const sub = path.join(dir, 'sub.gfvaultbundle'); // valid extension, but it's a dir
    fs.mkdirSync(sub);
    assert.deepEqual(validateExportPath(sub), { ok: false, reason: 'is-directory' });
  } finally { rm(dir); }
});

test('rejects an existing regular file by default → reason exists (no silent clobber, PR#112 finding 7)', () => {
  const dir = tmpDir();
  try {
    // Simulate a typed path that names an existing writable .json (e.g. a project package.json).
    const p = path.join(dir, 'package.json');
    fs.writeFileSync(p, '{"name":"victim"}', 'utf8');
    assert.deepEqual(validateExportPath(p), { ok: false, reason: 'exists' });
    // The file is untouched by the validator.
    assert.equal(fs.readFileSync(p, 'utf8'), '{"name":"victim"}');
  } finally { rm(dir); }
});

test('allowOverwrite:true permits an existing regular file', () => {
  const dir = tmpDir();
  try {
    const p = path.join(dir, 'old.gfvaultbundle');
    fs.writeFileSync(p, 'stale', 'utf8');
    const res = validateExportPath(p, { allowOverwrite: true });
    assert.equal(res.ok, true);
    assert.equal(res.path, path.resolve(p));
  } finally { rm(dir); }
});

test('rejects an existing symlink even with allowOverwrite (never write through a redirect)', () => {
  const dir = tmpDir();
  try {
    const realTarget = path.join(dir, 'real-secret.json');
    fs.writeFileSync(realTarget, 'secret', 'utf8');
    const link = path.join(dir, 'link.gfvaultbundle');
    fs.symlinkSync(realTarget, link);
    assert.deepEqual(validateExportPath(link), { ok: false, reason: 'symlink' });
    assert.deepEqual(validateExportPath(link, { allowOverwrite: true }), { ok: false, reason: 'symlink' });
    // The symlink's target is never written through.
    assert.equal(fs.readFileSync(realTarget, 'utf8'), 'secret');
  } finally { rm(dir); }
});

test('the resolved path collapses traversal to a canonical absolute path when the parent exists', () => {
  const dir = tmpDir();
  try {
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    // dir/sub/../out.gfvaultbundle → dir/out.gfvaultbundle (parent = dir, exists)
    const p = path.join(sub, '..', 'out.gfvaultbundle');
    const res = validateExportPath(p);
    assert.equal(res.ok, true);
    assert.equal(res.path, path.join(dir, 'out.gfvaultbundle'));
  } finally { rm(dir); }
});
