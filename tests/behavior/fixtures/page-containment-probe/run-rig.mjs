#!/usr/bin/env node
// Launches the probe rig under the project's own Electron binary, choosing the ozone
// platform the way scripts/dev-launch.mjs does. Usage: node run-rig.mjs [--phases=q1,q2,q3]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreloadBundle } from '../../../../scripts/build-preload.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const electron = require('electron');
const { decideOzonePlatform } = require('../../../../src/main/ozone-platform.js');

await buildPreloadBundle(); // the product bundle is a gitignored build product
const args = [path.join(here, 'rig-main.cjs')];
const env = { ...process.env };
const ozone = decideOzonePlatform({
  platform: process.platform,
  env: { WAYLAND_DISPLAY: env.WAYLAND_DISPLAY, XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR },
  exists: existsSync
});
if (ozone.platform === 'wayland') {
  env.WAYLAND_DISPLAY = ozone.waylandDisplay;
  args.push('--ozone-platform=wayland');
}
args.push(...process.argv.slice(2));
const child = spawn(electron, args, { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
