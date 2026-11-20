// Packaging gate (Mission 23 flight 03, leg runtime-fuses): read the Electron fuse
// wire from a PACKAGED binary and fail unless it is exactly the expected table.
// Usage: node scripts/check-fuses.mjs <path-to-packaged-binary>
// The three runtime fuses (RunAsNode, EnableNodeOptionsEnvironmentVariable,
// EnableNodeCliInspectArguments) must be off; every other fuse is pinned too, so a
// builder default moving or the cookie fuse turning on unannounced also fails.
// EXPECTED_FUSES is the single source; test/unit/check-fuses.test.js asserts it
// agrees with package.json build.electronFuses.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

// Wire bytes (@electron/fuses' FuseState is not exported from its entry point).
const FuseState = Object.freeze({ DISABLE: 0x30, ENABLE: 0x31, REMOVED: 0x72, INHERIT: 0x90 });

/** Fuse name -> expected state (true = enabled). Names are FuseV1Options keys. */
export const EXPECTED_FUSES = Object.freeze({
  RunAsNode: false,
  EnableCookieEncryption: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: false,
  OnlyLoadAppFromAsar: false,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: true,
  // Electron 45's wire has a ninth fuse (the binary exports IsWasmTrapHandlersEnabled)
  // that @electron/fuses 1.8.0 does not name; stock value is on. Read by index below.
  WasmTrapHandlers: true
});

/**
 * Wire indexes @electron/fuses 1.8.0 has no name for. Index 8 was read from the
 * Electron 45.4.1 binary (node_modules/electron/dist/electron), which exports the
 * symbol electron::fuses::IsWasmTrapHandlersEnabled; @electron/fuses 1.8.0's
 * FuseV1Options does not name it. The name is by position, so if Electron reorders
 * the wire it would describe the wrong fuse: re-check the symbol on each Electron
 * bump, and retire an entry here once @electron/fuses names that index.
 */
const LOCAL_NAMES = Object.freeze({ 8: 'WasmTrapHandlers' });

const LOCAL_HINT =
  '. If @electron/fuses now names a fuse this script names locally, retire its LOCAL_NAMES entry and use the library name in EXPECTED_FUSES.';

/** The three that make the binary a general-purpose Node runtime / debugger target. */
export const RUNTIME_FUSES = Object.freeze([
  'RunAsNode',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments'
]);

/**
 * Pure: fuse states -> verdict.
 * @param {Record<string, string>} states fuse name -> 'Enabled' | 'Disabled' | other
 * @param {Record<string, boolean>} [expected]
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function decideFuses(states, expected = EXPECTED_FUSES) {
  const problems = [];
  for (const name of Object.keys(expected)) {
    const want = expected[name] ? 'Enabled' : 'Disabled';
    const got = states && Object.hasOwn(states, name) ? states[name] : 'Missing';
    if (got === want) continue;
    const hint = got === 'Missing' ? LOCAL_HINT : '';
    const kind = RUNTIME_FUSES.includes(name) ? 'RUNTIME FUSE ON' : 'unexpected fuse state';
    problems.push(`${kind}: ${name} is ${got}, expected ${want}${hint}`);
  }
  for (const name of Object.keys(states || {})) {
    if (!Object.hasOwn(expected, name)) {
      problems.push(`unknown fuse: ${name} is ${states[name]}${LOCAL_HINT}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** @param {number | undefined} b */
function stateName(b) {
  if (b === FuseState.ENABLE) return 'Enabled';
  if (b === FuseState.DISABLE) return 'Disabled';
  if (b === FuseState.REMOVED) return 'Removed';
  if (b === FuseState.INHERIT) return 'Inherit';
  return `Unknown(${b})`;
}

/** Read a wire into the name -> state map decideFuses takes. */
export async function readFuseStates(binaryPath) {
  const wire = /** @type {any} */ (await getCurrentFuseWire(binaryPath));
  /** @type {Record<string, string>} */
  const states = {};
  const length = Object.keys(wire).filter((k) => /^\d+$/.test(k)).length;
  for (let i = 0; i < length; i++) {
    const name = /** @type {any} */ (FuseV1Options)[i] ?? /** @type {any} */ (LOCAL_NAMES)[i] ?? `Index${i}`;
    states[name] = stateName(wire[i]);
  }
  return states;
}

async function main(argv) {
  const target = argv[2];
  if (!target) {
    console.error('usage: node scripts/check-fuses.mjs <path-to-packaged-binary>');
    return 2;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    console.error(`check-fuses: not a file: ${target}`);
    return 2;
  }
  let states;
  try {
    states = await readFuseStates(target);
  } catch (err) {
    console.error(
      `check-fuses: ${target} is not an Electron binary with a fuse wire (${/** @type {Error} */ (err).message})`
    );
    return 2;
  }
  for (const [name, s] of Object.entries(states)) console.log(`  ${name} is ${s}`);
  const verdict = decideFuses(states);
  if (!verdict.ok) {
    for (const p of verdict.problems) console.error(`check-fuses: ${p}`);
    console.error('check-fuses: FAILED');
    return 1;
  }
  console.log('check-fuses: ok');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
