/**
 * Global type declarations for the menu-overlay sheet page (M05 Flight 8, Leg 2).
 * Mirrors the contextBridge surface exposed by src/preload/menu-overlay-preload.js.
 *
 * NOTE: the sheet document has window.menuOverlay, NOT window.goldfinch (the
 * project-wide renderer-globals.d.ts makes the chrome bridge *appear* typed here
 * too — it is absent at runtime). Same shim pattern as find-overlay-globals.d.ts.
 */

/** The serialized menu model delivered on menu-overlay:init (channel 3). The
 * model is template-shaped per menuType (Leg 3): `menu` items
 * {id,label,color?,variant?}; `info-popup` rows {type:'note'|'row'|'action',…};
 * `input-dialog` uses a fixed layout (model may be empty). */
interface MenuOverlayInitPayload {
  menuType: string;
  model: Array<{
    id?: string;
    label?: string;
    color?: string;
    variant?: string;
    type?: 'item' | 'separator' | 'note' | 'row' | 'action';
    text?: string;
    value?: string;
  }>;
  anchor: { alignRight?: number; alignLeft?: number; x?: number; y: number };
  startIndex?: number;
  token: number;
}

interface MenuOverlayBridge {
  version: number;
  /** process.platform, carried from Leg 1. */
  platform: string;
  /** main → sheet: render + open a menu from the model (channel 3). */
  onInit(cb: (d: MenuOverlayInitPayload) => void): void;
  /** sheet → main: an item was activated (channel 4). `value` (Leg 3) is the
   * input-dialog's text — main validates (string, ≤24) before forwarding. */
  sendActivated(payload: { id: string; token: number; value?: string }): void;
  /** sheet → main: the menu dismissed (channel 5). */
  sendDismissed(payload: { reason: string; token: number }): void;
}

interface Window {
  menuOverlay: MenuOverlayBridge;
}
