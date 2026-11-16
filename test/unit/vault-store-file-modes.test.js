'use strict';

// Leg `clipboard-and-file-modes` AC6/AC7: the vaults directory is 0700 and every file in it 0600 -
// created that way, and an existing (pre-leg, loose) tree is tightened once when the store loads.
// Skipped on win32: mode bits are not enforced there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vs = require('../../src/main/vault/vault-store');

const skip = process.platform === 'win32' ? 'mode bits are not enforced on win32' : false;
const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const mode = (p) => fs.statSync(p).mode & 0o777;
const make = (dir) =>
  vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => [{ id: 'work' }] });

test(
  'a new vault tree is owner-only: directory 0700, manager and vault files 0600 (skipped on win32: no mode bits)',
  { skip },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-modes-'));
    const old = process.umask(0);
    try {
      const store = make(dir);
      await store.setup({ masterPassword: 'correct horse battery staple' });
      const vdir = path.join(dir, 'vaults');
      assert.equal(mode(vdir), 0o700);
      const files = fs.readdirSync(vdir);
      assert.ok(files.includes('manager.json') && files.some((f) => f.endsWith('.gfvault')));
      for (const f of files) assert.equal(mode(path.join(vdir, f)), 0o600, f);
    } finally {
      process.umask(old);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'loading a store over a loose pre-existing tree tightens it once (skipped on win32: no mode bits)',
  { skip },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-modes-'));
    try {
      await make(dir).setup({ masterPassword: 'correct horse battery staple' });
      const vdir = path.join(dir, 'vaults');
      fs.writeFileSync(path.join(vdir, 'notes.txt'), '{}');
      fs.chmodSync(vdir, 0o755);
      for (const f of fs.readdirSync(vdir)) fs.chmodSync(path.join(vdir, f), 0o644);
      make(dir);
      assert.equal(mode(vdir), 0o700);
      for (const f of fs.readdirSync(vdir)) assert.equal(mode(path.join(vdir, f)), 0o600, f);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
