// Sortie 01 (default browser) DD3/DD4: the chrome half of OS URL intake. Main pushes
// `open-external-urls { urls }` (owner-routed, boot-gated); this controller holds every
// arrival behind a boot barrier — released by renderer.js in `.finally` on the WHOLE boot
// chain — so the URL tabs land AFTER session restore instead of racing it (queued sends
// flush BEFORE the boot-config reply). External URLs are ALWAYS untrusted default-jar
// tabs: never `trusted`, never a container (createTab(url, null) resolves the default
// jar, or a burner when the jars boot failed).
'use strict';

/**
 * @param {{
 *   onOpenExternalUrls: (cb: (urls: any) => void) => void,
 *   createTab: (url: string, container: any, opts?: any) => any,
 *   logger?: { warn?: (...a: any[]) => void }
 * }} deps
 * @returns {{ releaseBoot: () => void }}
 */
export function createExternalUrlsController({ onOpenExternalUrls, createTab, logger = console }) {
  /** @type {() => void} */
  let release = () => {};
  const barrier = new Promise((resolve) => {
    release = () => resolve(undefined);
  });

  onOpenExternalUrls((urls) => {
    if (!Array.isArray(urls) || urls.length === 0) return;
    const list = urls.filter((u) => typeof u === 'string');
    void barrier.then(() => {
      list.forEach((url, i) => {
        try {
          // All but the last open in the background; the last one activates.
          if (i < list.length - 1) createTab(url, null, { background: true });
          else createTab(url, null);
        } catch (error) {
          logger.warn?.('[external-urls] createTab failed:', error && error.message);
        }
      });
    });
  });

  return { releaseBoot: () => release() };
}
