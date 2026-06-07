'use strict';

// Preload for trusted internal `goldfinch://` pages (the Settings page). Runs under
// contextIsolation:true (opposite of web-webview preloads) via the params.partition
// branch in main's will-attach-webview. Minimal surface for Flight 4 — Flight 6 grows
// this into the home-page / Shields IPC bridge.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('goldfinchInternal', { version: 1 });
