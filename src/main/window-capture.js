// @ts-check
'use strict';

// Window-capture composite behind MCP `captureWindow` (Mission 24 Flight 3, leg 1).
// Moved verbatim out of main.js; Electron-FREE: the live handles (registry, app,
// desktopCapturer) are injected, the pure helpers are required directly.

// F7 DD4: pure, Electron-free identity pick for desktopCapturer sources.
const { pickSourceByMediaSourceId } = require('./capture-source-picker');
// F7 DD7 (recon S3): bounded capturePage race. Pure/Electron-free.
const { withCaptureTimeout } = require('./capture-timeout');
const { captureFailure, captureWithOneRetry } = require('./capture-failure');
// AUTOMATABLE_MENU_TYPES (M15 F3 L1, DD1c): IMPORTED from the resolver, never re-typed, so
// captureWindow's sheet layer and resolveContents' guard 3 are the SAME predicate.
const { AUTOMATABLE_MENU_TYPES } = require('./automation/resolve');

/**
 * @typedef {object} WindowGrabberDeps
 * @property {any} registry the window registry (`createWindowRegistry` result)
 * @property {any} app Electron `app` (only `app.commandLine.getSwitchValue` is read, per call)
 * @property {any} desktopCapturer Electron `desktopCapturer`
 */

/**
 * @param {WindowGrabberDeps} deps
 */
function createWindowGrabber(deps) {
  const { registry, app, desktopCapturer } = deps;

  // Grab a screenshot of the main window as a base64 PNG (Flight 3, Leg 1).
  // Tries desktopCapturer first (with correct thumbnailSize); falls back to a
  // chrome+guest canvas composite on WSLg (dep-free, via executeJavaScript).
  // Injected into the engine via deps.grabWindow so observe.js stays Electron-free.
  async function grabWindow(windowId) {
    // F6 Leg 2 review F2, restated at F7 DD3: resolve the record ONCE so window
    // bounds, chrome, and active tab all come from the SAME record. windowId omitted
    // → the last-focused record (pre-F7 behavior, unchanged); supplied → that window.
    // Everything downstream reads grabRec, so "never mix records mid-capture" holds
    // for free. A null here is the caller's no-such-window signal.
    const grabRec = windowId != null ? registry.get(windowId) : registry.getLastFocused();
    if (!grabRec) return null;
    const grabWin = grabRec.win;
    // Under the Wayland ozone backend (Leg-6 HAT fix — the dev launcher passes
    // --ozone-platform=wayland when a compositor socket is reachable), the app's
    // own surface is NOT in desktopCapturer's window-source list (X-window based;
    // no PipeWire under WSLg), so the best-size heuristic below would grab an
    // UNRELATED window. Skip straight to the capturePage composite fallback.
    const onWayland = app.commandLine.getSwitchValue('ozone-platform') === 'wayland';
    if (!onWayland) {
      try {
        // FIX 2(a): request thumbnail at the actual window content size so we get a
        // full-resolution capture, not the 150px-wide default thumbnail.
        const { width: cw, height: ch } = grabWin.getContentBounds();
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          fetchWindowIcons: false,
          thumbnailSize: { width: cw, height: ch }
        });
        // F7 DD4: bind by window IDENTITY, never by size. The pre-F7 best-size-match
        // scored every source against this window's bounds and took the largest overlap
        // — with two similar-sized windows open it could grab an UNRELATED window and
        // report success. "Capture *a* window that happens to be the same size" is not a
        // contract, and the exact identity is on the record (getMediaSourceId, an X11
        // Window id on Linux — electron.d.ts:2805-2809).
        //
        // NO fallback branch, by design: a miss falls through to the composite path
        // below, which is already correctly bound to grabRec. Do NOT restore "the
        // closest source" — that is the bug, not a safety net.
        const best = pickSourceByMediaSourceId(sources, grabWin.getMediaSourceId());
        if (best && best.thumbnail) {
          return best.thumbnail.toPNG().toString('base64');
        }
      } catch {
        /* desktopCapturer unavailable */
      }
    }
    // FIX 2(b) — WSLg / Wayland fallback: build a REAL chrome+guest composite in the
    // chrome renderer via executeJavaScript. Steps:
    //   1. capturePage() on chrome and active guest in parallel.
    //   2. Read the active guest view's MAIN-SIDE bounds (record ground truth) for
    //      the guest's placement on the canvas.
    //   3. Draw chrome first, then guest at those bounds, on an offscreen <canvas>;
    //      return the composite as a data URL.
    // This is dep-free and avoids shipping a broken chrome-only screenshot.
    //
    // M14 F3 HAT fix: the guest layer is positioned from the view's OWN getBounds(),
    // never the renderer-reported #webviews slot rect. During HTML fullscreen
    // (record.htmlFullscreen — see html-fullscreen.js) the renderer's slot rect is
    // stale by design (its bounds sends are DEFERRED as pendingBounds, never
    // applied), while the view's real bounds are the full window content area and
    // the view is raised above the chrome. Drawing at the slot rect falsely showed
    // chrome in the capture of a correct on-screen window. In normal mode
    // getBounds() equals the applied slot rect, so the composite is unchanged.
    try {
      // Same record as the window bounds above (F2: never mix records mid-capture).
      // The active entry comes off grabRec DIRECTLY (not via a second registry
      // resolve) so both the capture target and its bounds read the same record.
      const cc = grabRec.chromeView.webContents;
      const activeEntry = grabRec.activeTabWcId != null ? grabRec.tabViews.get(grabRec.activeTabWcId) : null;
      const activeWc = activeEntry ? activeEntry.view.webContents : null;
      // Squawk 0155: the guest layer exists only while the guest view is ON SCREEN. A guest
      // hidden behind a chrome takeover panel (load-failure / TLS interstitial / crash —
      // applyGuestVisibility's setVisible(false)) is not what the window shows: capturing it
      // rejected UnknownVizError on the first try, and on a retry composited the hidden
      // guest's stale pixels OVER the chrome panel that IS on screen. Skip it, exactly as the
      // overlay layers below are gated on isVisible(); the chrome capture carries the panel.
      const atc = activeWc && !activeWc.isDestroyed() && activeEntry.view.getVisible() ? activeWc : null;
      if (!cc || cc.isDestroyed()) return null;

      // Capture both views in parallel.
      // F7 DD7 (recon S3): each promise is bounded INDIVIDUALLY — a hang in EITHER would
      // wedge the whole Promise.all forever. Both HARD-REFUSE on timeout: chrome and the
      // active guest ARE the capture, so there is nothing to degrade to (contrast the
      // overlay layers below, which drop). The labels are what make the refusal name its
      // target: Promise.all would otherwise report whichever rejects first with no way to
      // tell the two captures apart.
      //
      // Squawk 0155: a non-timeout rejection is NAMED per step (captureFailure) instead of
      // falling into the catch-all's old bare null. The active guest additionally gets ONE
      // bounded retry (captureWithOneRetry, 250ms): a freshly created guest rejects
      // UnknownVizError until its first frame lands (~100-200ms after openTab, live-measured).
      // The retry re-checks liveness/visibility, so a guest closed or taken over during the
      // wait drops its layer rather than capturing what is no longer on screen.
      const captureGuest = () =>
        atc && !atc.isDestroyed() && activeEntry.view.getVisible()
          ? withCaptureTimeout(atc.capturePage(), 'active guest')
          : Promise.resolve(null);
      const [chromeImg, tabImg] = await Promise.all([
        withCaptureTimeout(cc.capturePage(), 'chrome').catch((err) => {
          throw captureFailure('chrome', err);
        }),
        atc ? captureWithOneRetry(captureGuest, 'active guest') : Promise.resolve(null)
      ]);
      if (!chromeImg || chromeImg.isEmpty()) throw captureFailure('chrome', new Error('empty image'));

      const chromeB64 = chromeImg.toPNG().toString('base64');
      const tabB64 = tabImg ? tabImg.toPNG().toString('base64') : null;

      // Guest placement: main-side ground truth (see the FIX 2(b) header). Same
      // window-content-DIP space as every other view bounds here — no renderer
      // round-trip needed for it.
      const guestBounds = tabImg && activeEntry ? activeEntry.view.getBounds() : null;

      // Layer list, bottom-up: guest at its true bounds, then the overlay views in
      // their z-order (find bar, then the menu-overlay sheet — the sheet is added
      // after the find re-assert on every show path, so it stacks above). Without
      // the overlay layers a Wayland-path captureWindow would silently omit an
      // OPEN MENU / find bar that IS on the real screen (the x11 desktopCapturer
      // path captured real window pixels, hiding this gap until the Leg-6 ozone
      // switch). View bounds are window-content DIPs — the same space the chrome
      // canvas is drawn in (the chrome view fills the window at 0,0).
      //
      // Draw order vs real z-order: the canvas draws chrome first, then the guest
      // (then overlays), so the guest sits ABOVE chrome in the composite — which
      // matches the screen exactly when it matters: in normal mode the guest only
      // covers the #webviews slot (chrome shows around it), and during HTML
      // fullscreen the raised guest at full-window bounds covers the chrome
      // completely (enter() hides the find overlay and closes the sheet, so no
      // overlay layer can wrongly stack above a fullscreen guest here).
      /** @type {{ b64: string, x: number, y: number, w: number, h: number }[]} */
      const layers = [];
      if (tabB64 && guestBounds) {
        layers.push({ b64: tabB64, x: guestBounds.x, y: guestBounds.y, w: guestBounds.width, h: guestBounds.height });
      }
      // Sortie 06 (DD10): the corner SAVE PROMPT is DELIBERATELY NOT a layer here. It renders the
      // offer's origin + username + vault choice and takes the operator's Save click, so a
      // captureWindow of it would be a pixel read of the save moment. Only the find overlay and the
      // sheet layers below are composited (pinned in test/unit/save-prompt-automation-guard.test.js);
      // the prompt is by-eye only.
      // F7 DD5: composite THE CAPTURED window's OWN overlay layers — the pre-F7
      // attachment gates (`=== grabWin`) are gone because each window's managers only
      // ever hold that window's views, so window A's open menu is structurally
      // unreachable from a capture of window B.
      const findView = grabRec.findOverlay && grabRec.findOverlay.isVisible() ? grabRec.findOverlay.getView() : null;
      if (findView && !findView.webContents.isDestroyed()) {
        try {
          const img = await withCaptureTimeout(
            /** @type {Electron.WebContents} */ (findView.webContents).capturePage(),
            'find overlay layer'
          );
          // F7 DD7 post-await re-check (TOCTOU): the gate above is SYNCHRONOUS and the await
          // is not — a hideFindOverlay() landing in the gap detaches the view mid-capture.
          // Written against THIS window's instance (leg 1 deleted the `=== grabWin` compares),
          // and NULL-TOLERANT because leg 1 nulls rec.findOverlay in the window's `close`
          // handler, so the slot can go null during the await.
          if (!grabRec.findOverlay || !grabRec.findOverlay.isVisible()) {
            /* detached mid-capture — drop the layer (same disposition as a layer timeout) */
          } else {
            const b = /** @type {Electron.WebContentsView} */ (/** @type {unknown} */ (findView)).getBounds();
            if (img && b.width && b.height)
              layers.push({ b64: img.toPNG().toString('base64'), x: b.x, y: b.y, w: b.width, h: b.height });
          }
        } catch (err) {
          // F7 DD7 layer degradation: a slow menu must not fail an otherwise-good window
          // capture. Matches the composite's existing tolerance for a failed layer (the
          // `.then(…, function() { return null; })` below already drops one SILENTLY — this
          // one LOGS). Contrast the chrome/guest captures above, which hard-refuse: those
          // ARE the capture.
          console.warn('[capture] dropping find overlay layer:', err && err.message);
        }
      }
      const sheetView = grabRec.sheet && grabRec.sheet.isVisible() ? grabRec.sheet.getView() : null;
      // M15 F3 L1 (DD1c) — PRE-EXISTING SECRET-READ PATH, CLOSED. This layer composited the
      // visible sheet unconditionally, so at admin tier captureWindow returned PIXELS of
      // `vault-unlock` and of the dismiss-locked one-time recovery-/access-/admin-key displays —
      // i.e. "the sheet is refused at every tier" was already false by a second door, exactly the
      // shape DD1a refuses `printToPDF` for. It is now gated on the SAME predicate the resolver's
      // guard 3 uses: registry.sheetMenuFor() (which itself returns null on a hidden sheet) plus
      // the imported AUTOMATABLE_MENU_TYPES allowlist. A non-allowlisted or absent menu drops the
      // layer entirely — the capture still returns chrome + guests, exactly as it does when the
      // sheet is hidden.
      const sheetMenuAdmitted = (view) =>
        !!view && !!view.webContents && AUTOMATABLE_MENU_TYPES.has(registry.sheetMenuFor(view.webContents)?.menuType);
      if (sheetView && sheetMenuAdmitted(sheetView) && !sheetView.webContents.isDestroyed()) {
        try {
          const img = await withCaptureTimeout(
            /** @type {Electron.WebContents} */ (sheetView.webContents).capturePage(),
            'sheet overlay layer'
          );
          // DD7 post-await re-check (TOCTOU) — see the find layer above. Null-tolerant for
          // the same reason (leg 1 nulls rec.sheet in the window's `close` handler).
          // M15 F3 L1 (DD1c): the re-check ALSO re-evaluates the menuType, not only isVisible() —
          // a capture that starts under `bookmarks-overflow` and is MODEL-REPLACED by `vault-unlock`
          // mid-capture would otherwise composite the vault pixels. This is the same TOCTOU
          // observe.js's assertSheetMenuStable closes one op over.
          if (!grabRec.sheet || !grabRec.sheet.isVisible() || !sheetMenuAdmitted(sheetView)) {
            /* detached mid-capture — drop the layer (same disposition as a layer timeout) */
          } else {
            const b = /** @type {Electron.WebContentsView} */ (/** @type {unknown} */ (sheetView)).getBounds();
            if (img && b.width && b.height)
              layers.push({ b64: img.toPNG().toString('base64'), x: b.x, y: b.y, w: b.width, h: b.height });
          }
        } catch (err) {
          // DD7 layer degradation — see the find layer above.
          console.warn('[capture] dropping sheet overlay layer:', err && err.message);
        }
      }

      if (layers.length === 0) {
        // No guest and no overlays — chrome-only capture.
        return chromeB64;
      }

      // Composite in the chrome renderer: draw chrome, then each layer in order.
      const layerArgs = JSON.stringify(
        layers.map((l) => ({ u: 'data:image/png;base64,' + l.b64, x: l.x, y: l.y, w: l.w, h: l.h }))
      );
      const compositeB64 = await cc.executeJavaScript(`(function(chromeDataUrl, layers) {
        function load(src) {
          return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() { resolve(img); };
            img.onerror = function() { reject(new Error('img load failed')); };
            img.src = src;
          });
        }
        return load(chromeDataUrl).then(function(chromeImg) {
          return Promise.all(layers.map(function(l) {
            return load(l.u).then(function(img) { return { img: img, l: l }; }, function() { return null; });
          })).then(function(loaded) {
            var canvas = document.createElement('canvas');
            canvas.width = chromeImg.naturalWidth;
            canvas.height = chromeImg.naturalHeight;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(chromeImg, 0, 0);
            loaded.forEach(function(e) {
              if (!e) return;
              ctx.drawImage(e.img, Math.round(e.l.x), Math.round(e.l.y), Math.round(e.l.w), Math.round(e.l.h));
            });
            return canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
          });
        });
      })('data:image/png;base64,${chromeB64}', ${layerArgs})`);

      return compositeB64 || chromeB64;
    } catch (err) {
      // F7 DD7 (AC10): a capture-timeout is a NAMED refusal and must reach the caller.
      // Left alone, this catch-all swallows it and the composite returns null, which
      // observe.captureWindow turns into the generic 'automation: chrome window
      // unavailable' — hiding the cause, i.e. exactly the silence DD7 exists to remove.
      // NOTE: this makes grabWindow REJECT where it previously only ever resolved-or-
      // null'd. Its sole consumer is observe.captureWindow, which awaits it, so the
      // rejection propagates to the tool adapter as isError — the intended DD7 outcome.
      //
      // Squawk 0155 generalizes DD7: NOTHING is swallowed here any more. A named refusal
      // (capture-timeout, or a step's capture-failed) passes through verbatim; anything else
      // (the executeJavaScript composite, a toPNG/getBounds throw) is refused as
      // 'automation: capture-failed — composite: …'. A null return now means only what the
      // early returns above mean — no record, or a destroyed chrome — which is what
      // 'automation: chrome window unavailable' has always claimed.
      throw captureFailure('composite', err);
    }
  }

  return { grabWindow };
}

module.exports = { createWindowGrabber };
