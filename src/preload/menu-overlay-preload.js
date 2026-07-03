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
  sendDismissed: (payload) => ipcRenderer.send('menu-overlay:dismissed', payload)
});
