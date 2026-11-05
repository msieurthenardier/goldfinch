'use strict';

// Preload for the corner save-prompt WebContentsView (Sortie 06, DD1/DD9). Chrome-class
// trust domain (file:// app page), context-isolated + sandboxed. Exposes ONLY
// `window.savePrompt` - never `window.goldfinch`. The channel set is exactly:
//   in:  onInit (save-prompt:init), onTimer (:timer), onResult (:result), onSaving (:saving),
//        onClear (:clear - the eager DOM scrub), onFocusFirst (:focus-first - the main-pushed
//        F6 focus request; the ONLY focus-related channel, main->page, token-checked by the page)
//   out: pointer / focus / height / dismiss (sends) and save (invoke) / consent (invoke); every message carries
//        the prompt's current token, which main checks.
// The model that arrives is METADATA ONLY (origin, username, card brand/last4, identity field
// labels, vault ids + labels) - never a secret.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('savePrompt', {
  platform: process.platform,
  onInit: (cb) => ipcRenderer.on('save-prompt:init', (_e, d) => cb(d)),
  onTimer: (cb) => ipcRenderer.on('save-prompt:timer', (_e, d) => cb(d)),
  onResult: (cb) => ipcRenderer.on('save-prompt:result', (_e, d) => cb(d)),
  onSaving: (cb) => ipcRenderer.on('save-prompt:saving', (_e, d) => cb(d)),
  onClear: (cb) => ipcRenderer.on('save-prompt:clear', (_e, d) => cb(d)),
  onFocusFirst: (cb) => ipcRenderer.on('save-prompt:focus-first', (_e, d) => cb(d)),
  pointer: (token, inside) => ipcRenderer.send('save-prompt:pointer', { token, inside }),
  focusInside: (token, inside) => ipcRenderer.send('save-prompt:focus', { token, inside }),
  height: (token, height) => ipcRenderer.send('save-prompt:height', { token, height }),
  dismiss: (token) => ipcRenderer.send('save-prompt:dismiss', { token }),
  save: (payload) => ipcRenderer.invoke('save-prompt:save', payload),
  consent: (payload) => ipcRenderer.invoke('save-prompt:consent', payload)
});
