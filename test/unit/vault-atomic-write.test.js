'use strict';

// Unit tests for src/main/vault/atomic-write.js — the vault store's crash-safe
// writer (Mission 12, Flight 1, Leg 2).
//
// Electron-free (node:fs only). Each test uses a real temp dir and cleans up.
// The crash-injection tests monkeypatch the SHARED node:fs singleton (the same
// object atomic-write.js holds, since require('node:fs') is a singleton) to make
// one syscall throw, then restore it — proving the destination is left intact and
// no temp file survives a failed write.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeFileAtomic } = require('../../src/main/vault/atomic-write');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-atomic-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function tmpLeftovers(dir, base) {
  return fs.readdirSync(dir).filter((n) => n.startsWith(`${base}.tmp-`));
}

test('writeFileAtomic writes the bytes and leaves no temp file', () => {
  const dir = tmpDir();
  try {
    const dest = path.join(dir, 'f.bin');
    writeFileAtomic(dest, Buffer.from('hello world'));
    assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world');
    assert.deepEqual(tmpLeftovers(dir, 'f.bin'), [], 'no .tmp-* file should remain');
  } finally {
    rm(dir);
  }
});

test('writeFileAtomic overwrites an existing file atomically', () => {
  const dir = tmpDir();
  try {
    const dest = path.join(dir, 'f.bin');
    writeFileAtomic(dest, Buffer.from('OLD'));
    writeFileAtomic(dest, Buffer.from('NEW-AND-LONGER'));
    assert.equal(fs.readFileSync(dest, 'utf8'), 'NEW-AND-LONGER');
    assert.deepEqual(tmpLeftovers(dir, 'f.bin'), []);
  } finally {
    rm(dir);
  }
});

test('crash mid-write (renameSync throws once) leaves the old bytes intact + no temp', () => {
  const dir = tmpDir();
  try {
    const dest = path.join(dir, 'f.bin');
    writeFileAtomic(dest, Buffer.from('OLD-CONTENTS'));

    const originalRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = () => {
      calls += 1;
      throw new Error('simulated crash during rename');
    };
    try {
      assert.throws(() => writeFileAtomic(dest, Buffer.from('NEW-CONTENTS')), /simulated crash/);
    } finally {
      fs.renameSync = originalRename;
    }

    assert.equal(calls, 1, 'rename should have been attempted exactly once');
    assert.equal(fs.readFileSync(dest, 'utf8'), 'OLD-CONTENTS', 'old bytes must survive the failed write');
    assert.deepEqual(tmpLeftovers(dir, 'f.bin'), [], 'the temp file must be cleaned up on failure');
  } finally {
    rm(dir);
  }
});

test('crash mid-write (fsyncSync throws once) leaves the old bytes intact + no temp', () => {
  const dir = tmpDir();
  try {
    const dest = path.join(dir, 'f.bin');
    writeFileAtomic(dest, Buffer.from('OLD-CONTENTS'));

    const originalFsync = fs.fsyncSync;
    fs.fsyncSync = () => {
      throw new Error('simulated fsync failure');
    };
    try {
      assert.throws(() => writeFileAtomic(dest, Buffer.from('NEW-CONTENTS')), /simulated fsync failure/);
    } finally {
      fs.fsyncSync = originalFsync;
    }

    assert.equal(fs.readFileSync(dest, 'utf8'), 'OLD-CONTENTS');
    assert.deepEqual(tmpLeftovers(dir, 'f.bin'), []);
  } finally {
    rm(dir);
  }
});

test('write to a nonexistent directory throws and creates nothing', () => {
  const dir = tmpDir();
  try {
    const dest = path.join(dir, 'no-such-subdir', 'f.bin');
    assert.throws(() => writeFileAtomic(dest, Buffer.from('data')));
    assert.ok(!fs.existsSync(dest));
  } finally {
    rm(dir);
  }
});
