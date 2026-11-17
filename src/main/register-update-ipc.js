'use strict';

// Update-check channels (Mission 23 Flight 3, leg `update-check`; flight DD1/DD9).
//
//   update:get-state                    chrome-or-internal, invoke. No arguments; a COPY of the state.
//   update:open-release-page            chrome, invoke.
//   internal-update-open-release-page   internal, invoke.
//
// Both open channels ignore every argument. They read main's OWN state, answer `false` when there is
// no `releaseUrl`, and otherwise send `open-external-urls` with exactly that one address to the chrome
// of the SENDER's own window (routing class 1, sender-resolved — never a last-focused accessor)
// through the boot-gated `queueChromeSend`; the chrome opens it as an ordinary untrusted tab. The
// window is not raised: the call comes from a click in it. A window that cannot be resolved, or whose
// chrome recovery is paused (where the send would be dropped), answers `false` and sends nothing.
//
// Neither open channel calls the reveal gate: nothing here is a secret, a key, or a caller-chosen path.
// The state PUSH (`update-state-changed`) is wired in main.js through `broadcastToChromeAndInternal`.

/**
 * @param {{
 *   ipcMain: any,
 *   gate: any,
 *   registerInternalHandler: Function,
 *   registry: any,
 *   getState: () => { current: string, available: string | null, releaseUrl: string | null, checkEnabled: boolean },
 *   queueChromeSend: (record: any, build: () => [string, any]) => void
 * }} deps
 */
function registerUpdateIpc({ ipcMain, gate, registerInternalHandler, registry, getState, queueChromeSend }) {
  const stateCopy = () => ({ ...getState() });

  /** @param {any} record */
  function openFor(record) {
    const url = getState().releaseUrl;
    if (typeof url !== 'string' || url === '') return false;
    if (!record || record.chromeRecoveryPaused) return false;
    queueChromeSend(record, () => ['open-external-urls', { urls: [url] }]);
    return true;
  }

  gate.chromeOrInternal.handle('update:get-state', () => stateCopy(), 'throw');
  gate.chrome.handle('update:open-release-page', (event) => openFor(registry.getWindowForChrome(event.sender)), {
    value: false
  });
  registerInternalHandler(ipcMain, 'internal-update-open-release-page', (event) =>
    openFor(registry.getWindowForGuest(event.sender && event.sender.id))
  );
}

module.exports = { registerUpdateIpc };
