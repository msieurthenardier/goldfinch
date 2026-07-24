'use strict';

// Preload for the menu-overlay sheet WebContentsView (M05 Flight 8, DD4/DD8).
// Chrome-class trust domain: file:// app chrome, mirrors find-overlay-preload.js —
// no origin gate. Exposes exactly the DD4 sheet-side channel set:
//   in:  onInit (menu-overlay:init — channel 3; {menuType, model, anchor,
//        startIndex, token})
//   out: sendActivated (menu-overlay:activated — channel 4; {id, token, value?} —
//        `value` is the Leg-3 input-dialog text; passed WHOLE, main validates
//        shape via sanitizeActivatedValue before forwarding on channel 6),
//        sendDismissed (menu-overlay:dismissed — channel 5; {reason, token})
// Main validates the sender by identity (the sheet's own webContents) and drops
// stale tokens. Stays in the eslint node-globals block alongside the other
// chrome-class preloads.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menuOverlay', {
  version: 1,
  platform: process.platform,
  onInit: (cb) => ipcRenderer.on('menu-overlay:init', (_e, d) => cb(d)),
  sendActivated: (payload) => ipcRenderer.send('menu-overlay:activated', payload),
  sendDismissed: (payload) => ipcRenderer.send('menu-overlay:dismissed', payload),
  // DD4 (M12 F2 chrome-unlock): the master password's DEDICATED request/response
  // secret channel. `secret` is a Uint8Array — NEVER routed through sendActivated
  // (channel-4, string-only / 24-char capped). This is the FIRST `invoke` from the
  // sheet preload (a reviewed upgrade over DD4's literal `send`): the wrong-
  // password re-prompt needs the { ok } result back to keep the sheet open.
  unlockVault: (payload) => ipcRenderer.invoke('menu-overlay:vault-unlock', payload),
  // M12 F3 Leg 4 (first-run-setup): the vault-set sheet's master-password SETUP channel.
  // Mirrors unlockVault byte-for-byte — `secret` is a Uint8Array, NEVER sendActivated
  // (string-only / 24-char capped); the sheet needs the { ok } result back to re-prompt.
  setupVault: (payload) => ipcRenderer.invoke('menu-overlay:vault-setup', payload),
  // M12 F3 Leg 5 (access-keys): the vault-stepup sheet's step-up MINT channel. Mirrors
  // setupVault — `secret` is a Uint8Array, NEVER sendActivated — but adds the NON-SECRET
  // `target` vault id. Returns { ok }; false re-prompts (wrong step-up password), true closes
  // it (main also opens vault-accesskey-show with the minted secret).
  stepupMint: (payload) => ipcRenderer.invoke('menu-overlay:vault-stepup-mint', payload),
  // M12 F4 Leg 1 (export-import): the vault-import-unlock sheet's secret channel. Mirrors
  // setupVault — `secret` is a Uint8Array, NEVER sendActivated — plus the NON-SECRET
  // `secretKind` (master | recovery). The destination target + the bundle are held main-side.
  // Returns { ok, reason? }; ok:false re-prompts (wrong secret) or, with reason:'collision' (M12 F5
  // HAT tail), surfaces a truthful "already exists" message; ok:true closes it (main runs the import).
  importVault: (payload) => ipcRenderer.invoke('menu-overlay:vault-import', payload),
  // M12 F4 Leg 2 (key-rotation): the vault-stepup sheet's RECOVERY-ROTATION channel (used when the
  // stepup sheet is in mode 'rotate-recovery'). Mirrors setupVault — `secret` (the master password)
  // is a Uint8Array, NEVER sendActivated. Returns { ok }; false re-prompts (wrong master password),
  // true closes it (main mints the new recovery key + opens vault-recovery-show).
  rotateRecovery: (payload) => ipcRenderer.invoke('menu-overlay:vault-rotate-recovery', payload),
  // M12 F4 Leg 3 (admin-key-provision): the vault-stepup sheet's ADMIN-KEY ROTATION channel (used
  // when the stepup sheet is in mode 'rotate-admin'). Mirrors rotateRecovery — `secret` (the master
  // password) is a Uint8Array, NEVER sendActivated. Returns { ok }; false re-prompts (wrong master
  // password), true closes it (main mints the new admin keypair + opens vault-adminkey-show).
  rotateAdminKey: (payload) => ipcRenderer.invoke('menu-overlay:vault-rotate-admin', payload),
  // M12 F4 Leg 2 (key-rotation): the vault-change-master sheet's TWO-SECRET channel — `oldSecret` +
  // `newSecret` are Uint8Arrays (the confirm check is renderer-side), NEVER sendActivated. Returns
  // { ok }; false re-prompts (wrong old password), true closes it.
  changeMaster: (payload) => ipcRenderer.invoke('menu-overlay:vault-change-master', payload),
  // M12 F4 Leg 2 (key-rotation): the vault-recover sheet's TWO-SECRET channel — `recoverySecret` +
  // `newSecret` are Uint8Arrays (the confirm check is renderer-side), NEVER sendActivated. Returns
  // { ok }; false re-prompts (wrong recovery key), true closes it (the store installs the MRK).
  recoverMaster: (payload) => ipcRenderer.invoke('menu-overlay:vault-recover', payload),
  // M12 F3 Leg 4: the recovery-show Copy — main owns the OS clipboard (string-only, the
  // chrome-clipboard-write precedent); a one-way send, sender-validated main-side.
  copyText: (text) => ipcRenderer.send('menu-overlay:copy-text', { text }),
  // DD7 (M12 F2 capture-save): the sheet's Save reports the chosen vaultId + the
  // stashed captureId (+ token). It rides an invoke like unlockVault (the sheet needs
  // the { saved } result back to re-prompt on a lock race). The CAPTURED PASSWORD is
  // NEVER on this path — it lives only in the main-side held record, keyed by captureId.
  captureSave: (payload) => ipcRenderer.invoke('menu-overlay:vault-capture-save', payload)
});
