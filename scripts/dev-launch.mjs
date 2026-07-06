#!/usr/bin/env node
// Dev launcher for `npm run dev` / `npm run dev:automation` (M05 F8 Leg-6 HAT fix).
//
// WHY THIS EXISTS: under WSLg RAIL, the X11/XWayland backend swallows the first
// OS click on another application's NATIVE window whenever the Goldfinch window
// is foreground and has received a real pointer click on any of its surfaces
// (guest page, chrome toolbar, or an open sheet menu) — a second click is
// needed. The Wayland backend does not exhibit the defect (verified with the
// Leg-6 OS-level repro harness). The ozone platform must be chosen ON THE REAL
// COMMAND LINE: Electron resolves it before any app code runs, so an in-app
// `appendSwitch` cannot change it (measured — see the note in src/main/main.js).
//
// WHAT IT DOES: when the caller did not pass an --ozone-platform* flag and a
// Wayland compositor socket is actually reachable (including the WSLg fallback
// socket outside XDG_RUNTIME_DIR — see src/main/ozone-platform.js), launch
// electron with `--ozone-platform=wayland` and a WAYLAND_DISPLAY that resolves.
// Otherwise launch exactly as before (x11 or whatever Electron picks) — real
// X-session Linux desktops and non-Linux platforms are untouched.
//
// Dev-only by design: packaged builds launch the binary directly and never run
// this script. The WSLg defect is a dev-environment concern (the packaged
// target platforms are native Windows/macOS/Linux desktops).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// In a plain Node context, require('electron') resolves to the binary path.
const electron = require('electron');
const { decideOzonePlatform } = require('../src/main/ozone-platform.js');

const args = process.argv.slice(2);
const env = { ...process.env };

// A caller-provided --ozone-platform / --ozone-platform-hint always wins.
if (!args.some((a) => a.startsWith('--ozone-platform'))) {
  const ozone = decideOzonePlatform({
    platform: process.platform,
    env: { WAYLAND_DISPLAY: env.WAYLAND_DISPLAY, XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR },
    exists: existsSync
  });
  if (ozone.platform === 'wayland') {
    // The WSLg fallback branch resolves the socket OUTSIDE $XDG_RUNTIME_DIR;
    // libwayland honors an absolute WAYLAND_DISPLAY (a no-op for the standard
    // branches, where the value is unchanged).
    env.WAYLAND_DISPLAY = ozone.waylandDisplay;
    args.push('--ozone-platform=wayland');
  }
}

const child = spawn(electron, ['.', ...args], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
