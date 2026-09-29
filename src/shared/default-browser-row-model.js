// Pure, DOM-free model for the goldfinch://settings "Default browser" row
// (sortie 01 leg 2 / AC4a). Projects { status, lastResult, inFlight } to render
// copy; never throws, never caches.

export const COPY = Object.freeze({
  dev: 'Available in installed builds only.',
  appimage:
    'The AppImage installs no system desktop entry, so it cannot be set as the default browser. Integrate it with your desktop, or use the .deb package.',
  platform: 'Setting the default browser is not supported on this platform.',
  isDefault: 'Goldfinch is your default browser.',
  notDefault: 'Goldfinch is not your default browser.',
  win32: 'Choose Goldfinch under Windows Default apps.',
  failure: "Couldn't set Goldfinch as the default browser.",
  unknown: 'Default browser status is unavailable.'
});

/**
 * @param {{ status?: any, lastResult?: any, inFlight?: boolean }} [input]
 * @returns {{ text: string, failureText: string, buttonHidden: boolean, buttonDisabled: boolean, buttonLabel: string }}
 */
export function defaultBrowserRowModel(input) {
  try {
    const { status, lastResult, inFlight } = input || {};
    const busy = inFlight === true;
    const base = { failureText: '', buttonHidden: false, buttonDisabled: busy, buttonLabel: 'Make default' };
    if (!status || typeof status !== 'object') {
      return { ...base, text: COPY.unknown, buttonDisabled: true };
    }
    if (status.supported !== true) {
      const text = status.reason === 'dev' ? COPY.dev : status.reason === 'appimage' ? COPY.appimage : COPY.platform;
      return { ...base, text, buttonDisabled: true };
    }
    if (status.platform === 'win32') {
      return { ...base, text: COPY.win32, buttonLabel: 'Open Default apps' };
    }
    const failed = !!lastResult && lastResult.ok === false;
    const failureText = failed ? COPY.failure : '';
    if (status.isDefault === true) {
      return { ...base, text: COPY.isDefault, failureText, buttonHidden: true };
    }
    return { ...base, text: COPY.notDefault, failureText };
  } catch {
    return {
      text: COPY.unknown,
      failureText: '',
      buttonHidden: false,
      buttonDisabled: true,
      buttonLabel: 'Make default'
    };
  }
}
