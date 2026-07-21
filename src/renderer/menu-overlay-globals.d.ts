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
  /** sheet → main: the DEDICATED vault-unlock secret channel (M12 F2, DD4). The
   * master password rides as a Uint8Array (never channel-4 activated). Returns
   * { ok } — false re-prompts the sheet (wrong password); true closes it. */
  unlockVault(payload: { token: number; secret: Uint8Array }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED vault-capture save channel (M12 F2 Leg 4, DD7). The
   * chosen vaultId + the stashed captureId (+ token) — NEVER the captured password
   * (held only in the main-side record). Returns { saved }; false re-prompts the sheet. */
  captureSave(payload: { token: number; captureId: string; vaultId?: string }): Promise<{ saved: boolean; reason?: string }>;
  /** sheet → main: the DEDICATED vault-set master-password setup channel (M12 F3 Leg 4).
   * Mirrors unlockVault — the password rides as a Uint8Array. Returns { ok }; false
   * re-prompts the sheet, true closes it (main also opens vault-recovery-show). */
  setupVault(payload: { token: number; secret: Uint8Array }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED vault-stepup access-key MINT channel (M12 F3 Leg 5).
   * Mirrors setupVault — the master password rides as a Uint8Array — plus the NON-SECRET
   * target vault id. Returns { ok }; false re-prompts (wrong step-up password), true closes
   * it (main also opens vault-accesskey-show with the minted secret). */
  stepupMint(payload: { token: number; secret: Uint8Array; target?: string }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED vault-import bundle-unlock channel (M12 F4 Leg 1). Mirrors
   * setupVault — the secret rides as a Uint8Array — plus the NON-SECRET secretKind
   * (master | recovery). The destination target + the bundle are held main-side. Returns
   * { ok }; false re-prompts (wrong secret), true closes it (main runs the import). */
  importVault(payload: { token: number; secret: Uint8Array; secretKind: 'master' | 'recovery' }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED recovery-key ROTATION channel (M12 F4 Leg 2). Used when the
   * reused vault-stepup sheet is in mode 'rotate-recovery'; the master password rides as a
   * Uint8Array. Returns { ok }; false re-prompts (wrong master password), true closes it (main
   * mints the new recovery key + opens vault-recovery-show). */
  rotateRecovery(payload: { token: number; secret: Uint8Array }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED admin-key ROTATION/PROVISION channel (M12 F4 Leg 3). Used when the
   * reused vault-stepup sheet is in mode 'rotate-admin'; the master password rides as a Uint8Array.
   * Returns { ok }; false re-prompts (wrong master password), true closes it (main mints the new
   * admin keypair + opens vault-adminkey-show). */
  rotateAdminKey(payload: { token: number; secret: Uint8Array }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED master-password CHANGE channel (M12 F4 Leg 2). The old + new
   * master passwords ride as Uint8Arrays (the confirm check is renderer-side). Returns { ok };
   * false re-prompts (wrong old password), true closes it. */
  changeMaster(payload: { token: number; oldSecret: Uint8Array; newSecret: Uint8Array }): Promise<{ ok: boolean }>;
  /** sheet → main: the DEDICATED RECOVER-after-forgotten-master channel (M12 F4 Leg 2). The
   * recovery key + new master password ride as Uint8Arrays (the confirm check is renderer-side).
   * Returns { ok }; false re-prompts (wrong recovery key), true closes it (the store installs the
   * MRK — the user ends unlocked). */
  recoverMaster(payload: { token: number; recoverySecret: Uint8Array; newSecret: Uint8Array }): Promise<{ ok: boolean }>;
  /** sheet → main: copy a string to the OS clipboard (M12 F3 Leg 4 recovery-show Copy).
   * One-way; sender-validated main-side. */
  copyText(text: string): void;
}

interface Window {
  menuOverlay: MenuOverlayBridge;
}
