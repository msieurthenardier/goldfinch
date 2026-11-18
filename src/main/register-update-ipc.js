'use strict';

// Update-check channels (Mission 23 Flight 3, leg `update-check`; flight DD1/DD9).
//
//   update:get-state                    chrome-or-internal, invoke. No arguments; a COPY of the state.
//   update:open-release-page            chrome, invoke.
//   internal-update-open-release-page   internal, invoke.
//   internal-update-download            internal, invoke (leg `update-download`). No arguments.
//
// Both open channels ignore every argument. They read main's OWN state, answer `false` when there is
// no `releaseUrl`, and otherwise send `open-external-urls` with exactly that one address to the chrome
// of the SENDER's own window (routing class 1, sender-resolved — never a last-focused accessor)
// through the boot-gated `queueChromeSend`; the chrome opens it as an ordinary untrusted tab. The
// window is not raised: the call comes from a click in it. A window that cannot be resolved, or whose
// chrome recovery is paused (where the send would be dropped), answers `false` and sends nothing.
//
// Neither open channel calls the reveal gate: nothing here is a secret, a key, or a caller-chosen path.
// `internal-update-download` ignores every argument too. It reads main's OWN state, builds the address
// from the validated `available` version and this machine's installer name (`installerUrlFor`: the
// constant slug and a fixed name only - never `releaseUrl`, never a response, never the dev override),
// and starts ONE ordinary download through the injected `startUpdateDownload(url)` (main.js wires it to
// the browser's own default session, which carries the `will-download` handler, so the file lands in
// the downloads folder and shows in the indicator and on goldfinch://downloads like any download). The
// app never opens, runs or verifies the file. A repeat while a download of the same address is still in
// progress starts nothing. It does not call the reveal gate either: no secret, no key, no caller-chosen
// path or address - one fixed, app-chosen file.
//
// The state PUSH (`update-state-changed`) is wired in main.js through `broadcastToChromeAndInternal`.

const path = require('node:path');
const { installerUrlFor } = require('../shared/update-version.js');

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// How long a click counts as "in progress" before its `will-download` record appears.
const START_LATCH_MS = 10 * 1000;

/**
 * @param {{
 *   ipcMain: any,
 *   gate: any,
 *   registerInternalHandler: Function,
 *   registry: any,
 *   getState: () => { current: string, available: string | null, releaseUrl: string | null, checkEnabled: boolean, downloadName?: string | null },
 *   queueChromeSend: (record: any, build: () => [string, any]) => void,
 *   startUpdateDownload?: (url: string) => boolean,
 *   getDownloadsManager?: () => ({ listAll: () => any[] } | null),
 *   now?: () => number
 * }} deps
 */
function registerUpdateIpc({
  ipcMain,
  gate,
  registerInternalHandler,
  registry,
  getState,
  queueChromeSend,
  startUpdateDownload = () => false,
  getDownloadsManager = () => null,
  now = () => Date.now()
}) {
  const stateCopy = () => ({ ...getState() });

  /** @param {any} record */
  function openFor(record) {
    const url = getState().releaseUrl;
    if (typeof url !== 'string' || url === '') return false;
    if (!record || record.chromeRecoveryPaused) return false;
    queueChromeSend(record, () => ['open-external-urls', { urls: [url] }]);
    return true;
  }

  /**
   * @param {any} r
   * @param {string} url
   * @param {string} name
   */
  function isThisDownload(r, url, name) {
    if (!r) return false;
    if (r.url === url) return true;
    if (r.partition != null || typeof r.filename !== 'string') return false;
    if (r.filename === name) return true;
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    return new RegExp('^' + escapeRegExp(base) + ' \\([1-9][0-9]*\\)' + escapeRegExp(ext) + '$').test(r.filename);
  }

  /** @type {{ url: string, at: number } | null} */
  let latch = null;

  /**
   * @param {string} url
   * @param {string} name
   */
  function downloadInProgress(url, name) {
    /** @type {any[]} */
    let records;
    try {
      const manager = getDownloadsManager();
      records = manager ? manager.listAll() : [];
    } catch {
      records = [];
    }
    const same = records.filter((r) => isThisDownload(r, url, name));
    // A record is "this download" when its address is exactly the built one, OR (a real GitHub
    // release-asset request redirects to another host and Chromium reports the LAST address in the
    // chain, so the stored `url` is probably NOT the built one) it has NO partition (an app-started
    // download on the browser's own session; a page-started one from a jar tab always carries one) and
    // its saved file name is the expected installer name, exactly or with the ` (n)` suffix `uniquePath`
    // adds before the extension. The record's `filename` is the saved file's own name. A redirecting
    // real download has NOT been observed yet; the first one is the operator's next candidate.
    // "In progress" is: this download, no end time, state `progressing` (a paused download is still
    // `progressing`, with `paused: true`). An `interrupted` record is NOT: a download that failed to
    // connect stays `interrupted` with no end time (measured, Electron 45.3.3), and a repeat click
    // after that must start a new download.
    if (same.some((r) => r.endTime == null && r.state === 'progressing')) return true;
    if (latch === null || latch.url !== url) return false;
    // The record only appears at `will-download`: until one started at or after the click shows up
    // (or the latch runs out), the click itself counts.
    const at = latch.at;
    if (same.some((r) => typeof r.startTime === 'number' && r.startTime >= at)) {
      latch = null;
      return false;
    }
    if (now() - at >= START_LATCH_MS) {
      latch = null;
      return false;
    }
    return true;
  }

  function startDownload() {
    const state = getState();
    const version = state && state.available;
    const name = state && state.downloadName;
    const url = typeof name === 'string' ? installerUrlFor(name, version) : null;
    if (url === null) return { ok: false, reason: 'unavailable' };
    if (downloadInProgress(url, name)) return { ok: true, name, already: true };
    latch = { url, at: now() };
    let started;
    try {
      started = startUpdateDownload(url) === true;
    } catch {
      started = false;
    }
    if (!started) {
      latch = null;
      return { ok: false, reason: 'failed' };
    }
    return { ok: true, name };
  }

  gate.chromeOrInternal.handle('update:get-state', () => stateCopy(), 'throw');
  gate.chrome.handle('update:open-release-page', (event) => openFor(registry.getWindowForChrome(event.sender)), {
    value: false
  });
  registerInternalHandler(ipcMain, 'internal-update-open-release-page', (event) =>
    openFor(registry.getWindowForGuest(event.sender && event.sender.id))
  );
  registerInternalHandler(ipcMain, 'internal-update-download', () => startDownload());
}

module.exports = { registerUpdateIpc };
