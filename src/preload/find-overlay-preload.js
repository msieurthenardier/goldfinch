'use strict';

// Preload for the floating find-overlay WebContentsView (M05 Flight 7, DD1/DD4).
// Chrome-class trust domain: file:// app chrome, mirrors chrome-preload.js — no
// origin gate. Exposes exactly the DD4 overlay-side channel set:
//   out: query (find-overlay:query), close (find-overlay:close)
//   in:  onInit (find-overlay:init),  onCount (find-overlay:count)
// plus the Leg-1 `platform`. Stays in the eslint node-globals block alongside
// chrome-preload.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('findOverlay', {
  platform: process.platform,
  query: (payload) => ipcRenderer.send('find-overlay:query', payload),
  close: () => ipcRenderer.send('find-overlay:close'),
  onInit: (cb) => ipcRenderer.on('find-overlay:init', (_e, d) => cb(d)),
  onCount: (cb) => ipcRenderer.on('find-overlay:count', (_e, d) => cb(d))
});
