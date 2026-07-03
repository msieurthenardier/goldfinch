'use strict';
// @ts-check

// Linux ozone backend decision (M05 F8 Leg-6 HAT fix) — pure, Electron-free,
// unit-tested (test/unit/ozone-platform.test.js). Applied by the DEV launcher
// `scripts/dev-launch.mjs` (`npm run dev` / `dev:automation`), which passes
// `--ozone-platform=wayland` on the real electron command line — the ozone
// platform is resolved BEFORE any app code runs, so main.js cannot apply this
// itself (an in-app appendSwitch changes what child processes report, not the
// platform actually used — measured via xwininfo).
//
// WHY: under WSLg RAIL, the X11/XWayland path SWALLOWS the first OS click on
// another application's window whenever the Goldfinch window is foreground and
// has received a real pointer click on any of its surfaces (guest page, chrome
// toolbar, or an open sheet menu) — the other window needs a SECOND click to
// come to the foreground. The Leg-6 OS-level repro harness (real injected
// Windows input + GetForegroundWindow truth) proved the swallow app-code
// independent — the freeze-era build, the F8 baseline, and the zero-view-op
// deferred-hide fix attempt all reproduce it identically, while the app
// receives a clean window blur and never re-asserts focus — and proved the
// Wayland ozone backend clean (click-away raises the other window first-click
// in 5/5 menu-open runs; menus still close via the same blur path).
//
// WHY NOT `ozone-platform-hint=auto`: Chromium's auto heuristic keys off the
// desktop session (XDG_SESSION_TYPE), which is unset under WSL — auto resolves
// to x11 there (measured), so the swallow stays. This helper does the socket
// probe auto should have done.
//
// DECISION: choose Wayland iff a Wayland compositor socket is actually
// reachable:
//   1. WAYLAND_DISPLAY absolute → that path (Wayland spec allows absolute).
//   2. WAYLAND_DISPLAY relative + XDG_RUNTIME_DIR → $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY.
//   3. WSLg fallback: /mnt/wslg/runtime-dir/$WAYLAND_DISPLAY — some WSLg setups
//      never mirror the socket into XDG_RUNTIME_DIR; Chromium only resolves
//      $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY, so this branch also returns the
//      absolute path for the caller to export as WAYLAND_DISPLAY (env mutation
//      at module scope precedes ozone init).
// X11-session desktops (WAYLAND_DISPLAY unset / no socket) keep x11 — unchanged.

/**
 * @param {{
 *   platform: string,
 *   env: { WAYLAND_DISPLAY?: string, XDG_RUNTIME_DIR?: string },
 *   exists: (path: string) => boolean
 * }} deps  `exists` is injected (fs.existsSync in production) so the decision
 *   is unit-testable with a synthetic filesystem.
 * @returns {{ platform: 'wayland', waylandDisplay: string } | { platform: null }}
 *   `waylandDisplay`: the value WAYLAND_DISPLAY must carry for Chromium to
 *   reach the socket (unchanged for branches 1-2; the absolute WSLg fallback
 *   path for branch 3).
 */
function decideOzonePlatform({ platform, env, exists }) {
  const none = /** @type {{ platform: null }} */ ({ platform: null });
  if (platform !== 'linux') return none;
  const wl = env.WAYLAND_DISPLAY;
  if (!wl) return none;

  // 1. Absolute WAYLAND_DISPLAY (Wayland spec) — trust it if the socket exists.
  if (wl.startsWith('/')) {
    return exists(wl) ? { platform: 'wayland', waylandDisplay: wl } : none;
  }
  // 2. The standard resolution Chromium itself performs.
  const rd = env.XDG_RUNTIME_DIR;
  if (rd && exists(`${rd}/${wl}`)) {
    return { platform: 'wayland', waylandDisplay: wl };
  }
  // 3. WSLg fallback: socket only present in the WSLg shared runtime dir.
  const wslg = `/mnt/wslg/runtime-dir/${wl}`;
  if (exists(wslg)) {
    return { platform: 'wayland', waylandDisplay: wslg };
  }
  return none;
}

module.exports = { decideOzonePlatform };
