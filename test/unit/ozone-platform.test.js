'use strict';
// @ts-check

// Unit tests for the Linux ozone backend decision (M05 F8 Leg-6 HAT fix).
// Pure helper, injected `exists` — no Electron, no real filesystem.

const { test } = require('node:test');
const assert = require('node:assert');
const { decideOzonePlatform } = require('../../src/main/ozone-platform');

const existsNone = () => false;
const existsOnly = (...paths) => (p) => paths.includes(p);

test('non-linux platforms never choose wayland', () => {
  for (const platform of ['win32', 'darwin']) {
    const r = decideOzonePlatform({
      platform,
      env: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' },
      exists: () => true
    });
    assert.deepStrictEqual(r, { platform: null });
  }
});

test('linux without WAYLAND_DISPLAY stays on the default (null)', () => {
  const r = decideOzonePlatform({
    platform: 'linux',
    env: { XDG_RUNTIME_DIR: '/run/user/1000' },
    exists: () => true
  });
  assert.deepStrictEqual(r, { platform: null });
});

test('standard resolution: relative WAYLAND_DISPLAY + XDG_RUNTIME_DIR socket', () => {
  const r = decideOzonePlatform({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' },
    exists: existsOnly('/run/user/1000/wayland-0')
  });
  // WAYLAND_DISPLAY stays UNCHANGED — Chromium resolves it itself.
  assert.deepStrictEqual(r, { platform: 'wayland', waylandDisplay: 'wayland-0' });
});

test('absolute WAYLAND_DISPLAY is trusted iff the socket exists', () => {
  const abs = '/mnt/wslg/runtime-dir/wayland-0';
  assert.deepStrictEqual(
    decideOzonePlatform({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: abs, XDG_RUNTIME_DIR: '/run/user/1000' },
      exists: existsOnly(abs)
    }),
    { platform: 'wayland', waylandDisplay: abs }
  );
  assert.deepStrictEqual(
    decideOzonePlatform({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: abs, XDG_RUNTIME_DIR: '/run/user/1000' },
      exists: existsNone
    }),
    { platform: null }
  );
});

test('WSLg fallback: socket only in /mnt/wslg/runtime-dir -> absolute display returned', () => {
  const r = decideOzonePlatform({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' },
    exists: existsOnly('/mnt/wslg/runtime-dir/wayland-0')
  });
  // The caller must export this absolute path as WAYLAND_DISPLAY for Chromium
  // (libwayland honors absolute values; the XDG socket is missing here).
  assert.deepStrictEqual(r, { platform: 'wayland', waylandDisplay: '/mnt/wslg/runtime-dir/wayland-0' });
});

test('XDG socket wins over the WSLg fallback when both exist', () => {
  const r = decideOzonePlatform({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' },
    exists: existsOnly('/run/user/1000/wayland-0', '/mnt/wslg/runtime-dir/wayland-0')
  });
  assert.deepStrictEqual(r, { platform: 'wayland', waylandDisplay: 'wayland-0' });
});

test('no reachable socket anywhere -> null (x11 default preserved)', () => {
  const r = decideOzonePlatform({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' },
    exists: existsNone
  });
  assert.deepStrictEqual(r, { platform: null });
});

test('relative WAYLAND_DISPLAY without XDG_RUNTIME_DIR still reaches the WSLg fallback', () => {
  const r = decideOzonePlatform({
    platform: 'linux',
    env: { WAYLAND_DISPLAY: 'wayland-0' },
    exists: existsOnly('/mnt/wslg/runtime-dir/wayland-0')
  });
  assert.deepStrictEqual(r, { platform: 'wayland', waylandDisplay: '/mnt/wslg/runtime-dir/wayland-0' });
});
