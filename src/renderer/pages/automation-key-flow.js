// @ts-check
// The automation page's key MINT flow (Mission 23 Flight 2, leg `admin-reach`, flight DD2). While an admin
// automation session is attached (or script it ran is still alive in this page) main asks the operator before
// it mints a key, so a mint can come back REFUSED: `{ key: null, refused: 'not-confirmed' }`. That is a normal
// answer - say so on the page's shared key-message line and show NO reveal box (today a null key would open
// an empty one). Extracted from automation.js so the shipped flow runs under `node --test` against fake
// elements (injected deps, no static import).

/** The key-message line for a refused mint. */
export const MINT_REFUSED_TEXT = 'No key created - the confirmation was not given.';

/**
 * @param {any} res  a mint reply
 * @returns {{ kind: 'key', key: string } | { kind: 'refused' } | { kind: 'none' }}
 */
export function classifyMint(res) {
  if (res && typeof res === 'object' && typeof res.key === 'string' && res.key !== '') {
    return { kind: 'key', key: res.key };
  }
  if (res && typeof res === 'object' && res.refused === 'not-confirmed') return { kind: 'refused' };
  return { kind: 'none' };
}

/**
 * Run one mint: on a key, refresh the key list THEN reveal it (the key is the LAST write - the post-mint
 * rebuild must not wipe it); on a refusal, announce and change nothing (no refresh, no reveal box); on an
 * empty reply (the env gate unset - defense in depth) show no reveal.
 * @param {{
 *   mint: () => Promise<any>,
 *   refresh: () => Promise<any>,
 *   reveal: (key: string) => void,
 *   announce: (text: string) => void,
 *   showErr: (e: unknown) => void
 * }} deps
 * @returns {Promise<void>}
 */
export function runKeyMint({ mint, refresh, reveal, announce, showErr }) {
  return Promise.resolve(mint())
    .then((res) => {
      const c = classifyMint(res);
      if (c.kind === 'refused') {
        announce(MINT_REFUSED_TEXT);
        return;
      }
      if (c.kind === 'none') return refresh().then(() => {});
      return refresh().then(() => reveal(c.key));
    })
    .catch(showErr);
}
