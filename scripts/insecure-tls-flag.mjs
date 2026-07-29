// Pure decision helper for the dev-only `--insecure-tls-fixtures` launch flag
// (M14 F1 L3, flight DD6) — the decideOzonePlatform shape: no I/O, no process
// access, unit-testable offline (test/unit/insecure-tls-flag.test.js).
//
// WHY: the client-cert behavior fixture serves TLS from a throwaway CA that
// Chromium will never trust, and goldfinch deliberately has no
// `certificate-error` handler. The ONLY sanctioned way to reach Chromium's
// `--ignore-certificate-errors` switch is this explicit flag on the dev/
// automation launch script — packaged builds launch the binary directly and
// never run dev-launch.mjs, so the bypass is dev-scoped by construction. The
// switch literal lives HERE and nowhere else (source-pinned): no flag → no
// switch, structurally.
//
// The flag is STRIPPED from the argv forwarded to Electron (dev-launch spreads
// process.argv.slice(2) verbatim; an unknown `--insecure-tls-fixtures` reaching
// Chromium would be a harmless-but-noisy unknown-switch warning).

export const INSECURE_TLS_FLAG = '--insecure-tls-fixtures';

/**
 * @param {string[]} argv  the launch script's forwarded args (process.argv.slice(2))
 * @returns {{ forwardArgs: string[], electronSwitches: string[] }}
 *   forwardArgs — argv with the flag stripped (unchanged copy when absent);
 *   electronSwitches — the Chromium switches the flag unlocks ([] when absent).
 */
export function decideInsecureTlsFixtures(argv) {
  const args = Array.isArray(argv) ? argv : [];
  if (!args.includes(INSECURE_TLS_FLAG)) {
    return { forwardArgs: args.slice(), electronSwitches: [] };
  }
  return {
    forwardArgs: args.filter((a) => a !== INSECURE_TLS_FLAG),
    electronSwitches: ['--ignore-certificate-errors'],
  };
}
