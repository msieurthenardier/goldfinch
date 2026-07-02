/**
 * Global type declarations for the find-overlay page (M05 Flight 7, Leg 2).
 * Mirrors the contextBridge surface exposed by src/preload/find-overlay-preload.js.
 *
 * NOTE: the overlay document has window.findOverlay, NOT window.goldfinch. The
 * project-wide renderer-globals.d.ts makes the chrome bridge *appear* typed in
 * find-overlay.js too — it is absent there at runtime. This shim exists so
 * `npm run typecheck` actually covers the overlay page module's real bridge.
 */

/** Payload for find-overlay:query — chrome-bar default option shape. */
interface FindOverlayQueryPayload {
  text: string;
  findNext: boolean;
  forward: boolean;
  matchCase: boolean;
}

interface FindOverlayBridge {
  /** process.platform, carried from Leg 1. */
  platform: string;
  /** overlay → main: run findInPage on the session's target guest. */
  query(payload: FindOverlayQueryPayload): void;
  /** overlay → main: explicit close (Esc / ✕) — the only refocusing close path. */
  close(): void;
  /** main → overlay: seed + focus on session open. */
  onInit(cb: (d: { findText: string }) => void): void;
  /** main → overlay: count path B (DD3). */
  onCount(cb: (d: { activeMatchOrdinal: number; matches: number }) => void): void;
}

interface Window {
  findOverlay: FindOverlayBridge;
}
