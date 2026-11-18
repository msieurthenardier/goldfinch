// @ts-check
'use strict';

// Sender resolution for the reveal gate (Mission 24 Flight 2, leg `open-download-ruling`). Electron-free:
// the registry is handed in, so the rules run under `node --test` with a fake.
//
// Until this leg every gated channel was an internal-page (guest) channel, so the gate only ever resolved
// a GUEST sender. The downloads popup's `open-downloaded-file` comes from the CHROME view, which is in no
// window's `tabViews`: guest-only resolution would answer `gone` and refuse the operator's own click while
// an admin session is attached. A chrome sender resolves to its own window and is "in front" whenever it is
// a registered chrome (an explicit branch, never a fallthrough). Anything unresolvable is null / false.

/**
 * @param {{ getWindowForGuest: (id: number) => any, getWindowForChrome: (sender: any) => any }} registry
 */
function createGateSenderResolvers(registry) {
  return {
    /** @param {any} sender */
    windowFor(sender) {
      try {
        return registry.getWindowForGuest(sender.id)?.win ?? registry.getWindowForChrome(sender)?.win ?? null;
      } catch {
        return null;
      }
    },
    /** @param {any} sender */
    isActive(sender) {
      try {
        const g = registry.getWindowForGuest(sender.id);
        if (g) return g.activeTabWcId === sender.id;
        return registry.getWindowForChrome(sender) != null;
      } catch {
        return false;
      }
    }
  };
}

module.exports = { createGateSenderResolvers };
